#!/usr/bin/env bash
set -euo pipefail

namespace="workspace-race"
psql --set ON_ERROR_STOP=1 --command \
  "INSERT INTO pocket_task_lifecycle_snapshots (namespace, schema_version, record_version, payload) VALUES ('\${namespace}', 1, 0, '[]'::jsonb)"

writer_log="$(mktemp)"
cleanup() {
  rm -f "$writer_log"
}
trap cleanup EXIT

# Writer A obtains the row lock, then pauses while holding it. Writer B starts
# with the same expected version and must wait, then update zero rows after A
# commits version 1.
psql --set ON_ERROR_STOP=1 --no-align --tuples-only >"$writer_log" 2>&1 <<SQL &
BEGIN;
SELECT namespace
  FROM pocket_task_lifecycle_snapshots
 WHERE namespace = '\${namespace}'
 FOR UPDATE;
\echo ROW_LOCK_HELD
SELECT pg_sleep(2);
UPDATE pocket_task_lifecycle_snapshots
   SET payload = '[{"id":"writer-a"}]'::jsonb,
       record_version = record_version + 1,
       updated_at = CURRENT_TIMESTAMP
 WHERE namespace = '\${namespace}'
   AND record_version = 0;
COMMIT;
SQL
writer_pid=$!

lock_seen=false
for _ in $(seq 1 50); do
  if grep -q "ROW_LOCK_HELD" "$writer_log"; then
    lock_seen=true
    break
  fi
  sleep 0.1
done

if [ "$lock_seen" != true ]; then
  cat "$writer_log"
  kill "$writer_pid" 2>/dev/null || true
  wait "$writer_pid" 2>/dev/null || true
  echo "Writer A did not acquire the row lock in time" >&2
  exit 1
fi

stale_result="$(psql --set ON_ERROR_STOP=1 --quiet --no-align --tuples-only --command \
  "UPDATE pocket_task_lifecycle_snapshots SET payload = '[{\"id\":\"writer-b\"}]'::jsonb, record_version = record_version + 1 WHERE namespace = '\${namespace}' AND record_version = 0 RETURNING record_version")"

wait "$writer_pid"

if [ -n "$stale_result" ]; then
  echo "Stale writer unexpectedly updated a row: $stale_result" >&2
  exit 1
fi

final_state="$(psql --set ON_ERROR_STOP=1 --no-align --tuples-only --command \
  "SELECT record_version || ':' || (payload -> 0 ->> 'id') FROM pocket_task_lifecycle_snapshots WHERE namespace = '\${namespace}'")"

if [ "$final_state" != "1:writer-a" ]; then
  echo "Unexpected final concurrent snapshot state: $final_state" >&2
  exit 1
fi

echo "East PostgreSQL concurrent stale-writer check passed"

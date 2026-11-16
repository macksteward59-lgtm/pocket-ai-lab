\set ON_ERROR_STOP on

-- Apply the real migration before this script. Exercise the same row-lock and
-- compare-and-swap statements used by PostgresTaskLifecycleStore.
INSERT INTO pocket_task_lifecycle_snapshots (namespace, schema_version, record_version, payload)
VALUES ('workspace-a', 1, 0, '[]'::jsonb),
       ('workspace-b', 1, 0, '[]'::jsonb);

-- Repeated initialization is idempotent for an existing namespace.
INSERT INTO pocket_task_lifecycle_snapshots (namespace, schema_version, record_version, payload)
VALUES ('workspace-a', 1, 0, '[]'::jsonb)
ON CONFLICT (namespace) DO NOTHING;

DO $$
DECLARE
  locked_version BIGINT;
  changed_rows INTEGER;
BEGIN
  SELECT record_version INTO locked_version
    FROM pocket_task_lifecycle_snapshots
   WHERE namespace = 'workspace-a'
   FOR UPDATE;

  IF locked_version <> 0 THEN
    RAISE EXCEPTION 'Expected initial record version 0';
  END IF;

  UPDATE pocket_task_lifecycle_snapshots
     SET payload = '[{"id":"task-a"}]'::jsonb,
         record_version = record_version + 1,
         updated_at = CURRENT_TIMESTAMP
   WHERE namespace = 'workspace-a'
     AND record_version = 0;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;

  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'Expected first compare-and-swap to update exactly one row';
  END IF;
END
$$;

-- A stale writer using the old version must affect zero rows.
DO $$
DECLARE changed_rows INTEGER;
BEGIN
  UPDATE pocket_task_lifecycle_snapshots
     SET payload = '[{"id":"stale-writer"}]'::jsonb,
         record_version = record_version + 1,
         updated_at = CURRENT_TIMESTAMP
   WHERE namespace = 'workspace-a'
     AND record_version = 0;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;

  IF changed_rows <> 0 THEN
    RAISE EXCEPTION 'Stale compare-and-swap unexpectedly changed a committed row';
  END IF;
END
$$;

-- The two namespaces remain independent.
DO $$
DECLARE
  version_a BIGINT;
  version_b BIGINT;
  task_a TEXT;
BEGIN
  SELECT record_version, payload -> 0 ->> 'id'
    INTO version_a, task_a
    FROM pocket_task_lifecycle_snapshots
   WHERE namespace = 'workspace-a';
  SELECT record_version INTO version_b
    FROM pocket_task_lifecycle_snapshots
   WHERE namespace = 'workspace-b';

  IF version_a <> 1 OR task_a <> 'task-a' OR version_b <> 0 THEN
    RAISE EXCEPTION 'Namespace isolation or committed snapshot state is incorrect';
  END IF;
END
$$;

-- A failed transaction must leave the last committed snapshot unchanged.
BEGIN;
UPDATE pocket_task_lifecycle_snapshots
   SET payload = '[{"id":"uncommitted"}]'::jsonb,
       record_version = record_version + 1
 WHERE namespace = 'workspace-a'
   AND record_version = 1;
ROLLBACK;

DO $$
DECLARE
  current_version BIGINT;
  task_id TEXT;
BEGIN
  SELECT record_version, payload -> 0 ->> 'id'
    INTO current_version, task_id
    FROM pocket_task_lifecycle_snapshots
   WHERE namespace = 'workspace-a';

  IF current_version <> 1 OR task_id <> 'task-a' THEN
    RAISE EXCEPTION 'Rollback did not preserve the last committed snapshot';
  END IF;
END
$$;

-- Schema and payload constraints reject invalid durable state.
DO $$
BEGIN
  BEGIN
    INSERT INTO pocket_task_lifecycle_snapshots (namespace, schema_version, payload)
    VALUES ('invalid-schema', 0, '[]'::jsonb);
    RAISE EXCEPTION 'Expected non-positive schema version to be rejected';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO pocket_task_lifecycle_snapshots (namespace, schema_version, payload)
    VALUES ('invalid-payload', 1, '{"not":"an array"}'::jsonb);
    RAISE EXCEPTION 'Expected non-array snapshot payload to be rejected';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;

SELECT 'East PostgreSQL lifecycle integration checks passed' AS result;

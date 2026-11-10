#!/bin/sh
# Start the loopback governance sidecar and the local export watcher.
# Do not exec the watcher: under dash, exec runs the EXIT trap and would
# kill uvicorn before the watcher is the foreground process.
# This script does not contact scan targets and does not set authorized.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
HOST=${GOVERNANCE_SIDECAR_HOST:-127.0.0.1}
PORT=${GOVERNANCE_SIDECAR_PORT:-8765}
case "$HOST" in
  127.0.0.1|localhost|::1) ;;
  *)
    echo "Refusing to bind a non-loopback host. Use 127.0.0.1." >&2
    exit 1
    ;;
esac
export GOVERNANCE_SIDECAR_HOST="$HOST"
export GOVERNANCE_SIDECAR_PORT="$PORT"
export GOVERNANCE_AUTHORIZED=false
export GOVERNANCE_DASHBOARD_DIR="$ROOT/scripts/desktop/governance-dashboard"
export PYTHONPATH="$ROOT/services/ai-integrator-automator/src${PYTHONPATH:+:$PYTHONPATH}"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3.10 or newer is required. Governance is unavailable." >&2
  exit 1
fi
if ! python3 -c "import fastapi, uvicorn, pydantic, cryptography, defusedxml" >/dev/null 2>&1; then
  echo "Install the sidecar first: python3 -m pip install -e 'services/ai-integrator-automator[dev]'" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required to run the watcher." >&2
  exit 1
fi
WATCH=${GOVERNANCE_WATCH_DIR:-$ROOT/.governance-inbox}
mkdir -p "$WATCH" "$ROOT/.governance-outbox"
cd "$ROOT"
SIDECAR_PID=
WATCHER_PID=
cleanup() {
  if [ -n "${SIDECAR_PID:-}" ]; then
    kill "$SIDECAR_PID" >/dev/null 2>&1 || true
    SIDECAR_PID=
  fi
  if [ -n "${WATCHER_PID:-}" ]; then
    kill "$WATCHER_PID" >/dev/null 2>&1 || true
    WATCHER_PID=
  fi
}
trap 'cleanup; exit 143' INT TERM
trap cleanup EXIT
python3 -m uvicorn ai_integrator.main:app --host "$HOST" --port "$PORT" &
SIDECAR_PID=$!
python3 - <<PY
import time
import urllib.request
url = "http://${HOST}:${PORT}/api/v1/health"
last = "not started"
for _ in range(50):
    try:
        with urllib.request.urlopen(url, timeout=0.5) as response:
            if response.status == 200:
                raise SystemExit(0)
    except SystemExit:
        raise
    except Exception as exc:
        last = exc
    time.sleep(0.1)
raise SystemExit("sidecar did not become healthy: %s" % last)
PY
node --import tsx scripts/desktop/TelemetryWatcher.ts --dir "$WATCH" --out "$ROOT/.governance-outbox" --sidecar "http://${HOST}:${PORT}" &
WATCHER_PID=$!
wait "$WATCHER_PID"
status=$?
cleanup
trap - EXIT INT TERM
exit "$status"

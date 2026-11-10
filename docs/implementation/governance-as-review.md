# Run the governance review stack

The sidecar and watcher parse local scanner exports. They do not contact the hosts named in those exports. `authorized` stays false.

## Install

From the repository root, with Python 3.11+ and Node.js 22+:

```bash
python3 -m pip install -e "services/ai-integrator-automator[dev]"
npm install
```

If Poetry is installed, the same tree can be tested with:

```bash
cd services/ai-integrator-automator
poetry install
poetry run pytest
```

The CI job uses pip:

```bash
cd services/ai-integrator-automator
python3 -m pip install -e ".[dev]"
python3 -m pytest
```

From the repository root the equivalent is `npm run test:governance`. That command is separate from `npm test`, so the consumer workflows do not need the Python packages.

## Environment

```bash
node scripts/desktop/setup-env.mjs
```

This copies `.env.example` to `.env` when `.env` is missing. The example keeps `GOVERNANCE_AUTHORIZED=false` and an empty `GOVERNANCE_FERNET_KEY`. Put a locally generated Fernet key only in the gitignored `.env` if you want policy encryption. An empty allowlist keeps every target out of scope.

Check the tree without starting a server:

```bash
node scripts/desktop/verify-governance-stack.mjs
```

## Sidecar and watcher

```bash
export GOVERNANCE_ALLOWLIST="app.example.com"
export GOVERNANCE_SIDECAR_HOST="127.0.0.1"
sh scripts/desktop/start-governance-pipeline.sh
```

The script refuses any host other than `127.0.0.1`, `localhost`, or `::1`. It starts `uvicorn` on that host and then runs the watcher against `.governance-inbox`. Drop a `.xml`, `.csv`, or `.json` export in that directory. Results are written under `.governance-outbox`. Those directories are gitignored.

One watcher pass, with the sidecar already running:

```bash
node --import tsx scripts/desktop/TelemetryWatcher.ts \
  --dir .governance-inbox \
  --out .governance-outbox \
  --sidecar http://127.0.0.1:8765 \
  --once
```

Open the viewer at `http://127.0.0.1:8765/dashboard/`. It polls `/api/v1/health` and can post an export to `/api/v1/governance/review`. Health is HTTP 200 with status `healthy`, `degraded`, or `error`. `authorized` in that body is false.

## Tests

```bash
npm run test:governance
npm run test:engine
npm test
npm run build
```

`packages/intelligence/__tests__/gate01.test.ts` covers an in-scope upload that reaches `REVIEW_READY` and spawns an existing security specialist, and an out-of-scope upload that is dropped with `SecurityBoundaryViolation`.

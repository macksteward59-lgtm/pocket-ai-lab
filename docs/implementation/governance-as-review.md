# Run the governance review stack

One command starts the chat app, llama-server when a GGUF is already configured, and the governance sidecar. Nothing in this path contacts the hosts named in a scanner export. `authorized` stays false.

## Single command

From the repository root, after `npm install` and with Node.js 22 or newer:

```bash
./start-pocket-ai-lab.sh
```

That is the same entry as `Start Pocket AI Lab.command`, `Start Pocket AI Lab.bat`, and `node scripts/desktop/launcher.mjs`.

- Chat: `http://127.0.0.1:4173/`
- Governance dashboard: `http://127.0.0.1:8765/dashboard/`
- llama-server: `127.0.0.1:8080` only when you already selected a GGUF. The launcher does not download weights.

The first governance start creates `.venv` in the project and installs `services/ai-integrator-automator` when Python 3.10 or newer is on `PATH`. That install needs a network once. If Python is missing, chat still starts and the launcher prints that governance is unavailable.

```bash
./start-pocket-ai-lab.sh --no-governance
./start-pocket-ai-lab.sh --headless
```

Ctrl-C sends SIGTERM to the children this launcher started.

`node scripts/desktop/setup-env.mjs` copies `.env.example` to the gitignored `.env` and writes a Fernet key there when the key line is empty. The example file stays empty. Do not commit `.env`.

The dashboard can paste or upload a Burp XML, Nessus CSV, or ZAP export, edit the local allowlist, and download the review JSON and the Markdown report. The allowlist is stored under `.governance/`, which is gitignored.

## Sidecar by itself

```bash
sh scripts/desktop/start-governance-pipeline.sh
```

The script is POSIX `sh`. It does not `exec` the watcher, so the sidecar stays up while exports are watched. It refuses any host other than `127.0.0.1`, `localhost`, or `::1`.

One watcher pass, with the sidecar already running:

```bash
node --import tsx scripts/desktop/TelemetryWatcher.ts \
  --dir .governance-inbox \
  --out .governance-outbox \
  --sidecar http://127.0.0.1:8765 \
  --once
```

## Tests

```bash
npm test
npm run test:governance
npm run test:simulation
npm run build
```

`npm run test:simulation` replays fabricated `example.com` exports through the parsers and `PolicyChecker` without contacting those hosts. `npm run test:governance` is `pytest` for the sidecar. The main `npm test` script does not require the Python package; the governance CI job runs both.

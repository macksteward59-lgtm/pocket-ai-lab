# Portable desktop launcher

This is a loopback launcher and a distributable archive. It is not a signed native installer, not an iPhone app, and not a production deployment. Windows and macOS entrypoints are included and were not run on those systems. Linux is the system used to build and smoke-test the archive.

Install Node.js 22 or newer and run `npm install` once in the unpacked folder. This prepares the chat app. The default launch also starts the governance dashboard and watcher when a compatible Python is available. Their first start can require a network connection.

## Start

From the checkout root, run the Node entry point directly.

```bash
node scripts/desktop/launcher.mjs
```

`--headless` or `POCKET_LAUNCHER_HEADLESS=1` leaves the browser closed and prints the loopback URL. Governance still starts by default. A browser `ERR_FAILED` alone does not establish whether the process exited.

For a headless, offline chat launch with the Node dependencies already installed, use the existing governance opt-out.

```bash
node scripts/desktop/launcher.mjs --headless --no-governance
```

`POCKET_NO_GOVERNANCE=1` also skips the dashboard and watcher. To use governance offline, prepare the project-local `.venv` with Python 3.10 or newer and the dependencies of `services/ai-integrator-automator` before disconnecting. On startup the governance runtime creates the virtual environment if needed and checks that FastAPI, Uvicorn, Pydantic, cryptography and defusedxml can be imported. If the check fails, it invokes pip to install the sidecar and its dependencies. Local inference also requires the GGUF and llama-server described below.

The archive root start script runs `scripts/desktop/launcher.mjs`. That module imports `scripts/local-gguf/lib.mjs`. The archive includes that file, the tests, and `tsconfig.json`. It does not place a second `launcher-lib.mjs` at the archive root.

The web server binds to `127.0.0.1`. A request to use another host is forced back to loopback. The rate limits and browser-request checks in the web server stay in place. `authorized` stays false.

Memory is stored in `~/.pocket-ai-lab/memory` and is kept across launches. Logs go to `~/.pocket-ai-lab/logs/launcher.log` with token-like values redacted.

If the preferred port is already taken by another program, the launcher leaves that program alone and tries a nearby port. It stops a previous process only when the recorded pid is still running this launcher's server or the llama-server it started.

## Model

Set `POCKET_GGUF_PATH` to a `.gguf` file you already have, or write `{"ggufPath":"/path/to/model.gguf"}` to `~/.pocket-ai-lab/model.json`. Optional `POCKET_GGUF_SHA256` checks that file and refuses to start llama-server when the checksum differs.

The experimental custom GGUF is not in the archive. A missing path is reported, and the base smoke model is not renamed to stand in for it. Without a selected file, or without `llama-server`, the app can still open and the model is reported as not ready.

## Archive

```bash
npm run package:desktop
```

The command writes `pocket-ai-lab-desktop.zip`, a `.sha256` file, and a manifest. The manifest records the source commit, `standaloneNativeInstaller: false`, `windowsTested: false`, `macTested: false`, `weightsIncluded: false`, `greetingQualityFixed: false`, and `authorized: false`. Weights, `.env` files, private keys, and `node_modules` are excluded. After `npm install`, `npm test` and `npm run build` run from the unpacked folder. A Qwen 0.5B greeting can still be a poor sentence when the status is 200.

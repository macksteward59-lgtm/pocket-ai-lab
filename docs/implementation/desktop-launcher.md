# Portable desktop launcher

This is a loopback launcher and a distributable archive. It is not a signed native installer, not an iPhone app, and not a production deployment. Windows and macOS entrypoints are included and were not run on those systems. Linux is the system used to build and smoke-test the archive.

Node.js 22 or newer has to be installed first. `npm install` has to be run once in the unpacked folder. The launcher does not run that install, does not download a GGUF, and does not install llama-server. After that setup, later launches do not need a network connection.

## Start

From a checkout:

```bash
scripts/desktop/start-pocket-ai-lab.sh
scripts/desktop/start-pocket-ai-lab.sh --headless
```

`--headless`, or `POCKET_LAUNCHER_HEADLESS=1`, leaves the browser closed and prints the loopback URL. It does not restart the server in a loop and it does not install dependencies. A browser `ERR_FAILED` is not treated as evidence that this process exited.

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

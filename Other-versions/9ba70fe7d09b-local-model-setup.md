# Local model setup

This is the loopback smoke path. It is not iPhone hardware acceptance, not a trained EAGLE-3 accelerator, and not an APEX authorization. A completion from llama-server is untrusted text. The smoke record sets `authorized` and `hardwareAcceptance` to false.

Paths below are relative to a checkout. A directory chosen with `POCKET_GGUF_DIR` on one machine is not a path on another machine. Do not commit `*.gguf` files. `models/` is gitignored.

## 1. Fetch the pinned smoke GGUF

The pin is `scripts/local-gguf/pin.json`:

| Field | Value |
|---|---|
| Default file | `SmolLM2-135M-Instruct-Q4_K_M.gguf` |
| Also pinned | `qwen2.5-0.5b-instruct-q4_k_m.gguf` (`POCKET_GGUF_ID=qwen2.5-0.5b-instruct-q4_k_m`) |
| Repo | `bartowski/SmolLM2-135M-Instruct-GGUF` |
| Revision | `09816acd5d99df7be770d85ea30822623dab342c` |
| SHA-256 | `2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d` |
| Bytes | `105454432` |
| License | `apache-2.0` |
| Base model | `HuggingFaceTB/SmolLM2-135M-Instruct` |

The Qwen base smoke pin is `Qwen/Qwen2.5-0.5B-Instruct-GGUF` revision `9217f5db79a29953eb74d5343926648285ec7e67`, file `qwen2.5-0.5b-instruct-q4_k_m.gguf`, SHA-256 `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`, 491400032 bytes, Apache-2.0. It is not a custom fine-tune. Select it with `POCKET_GGUF_ID=qwen2.5-0.5b-instruct-q4_k_m`.

```bash
npm install
node scripts/local-gguf/fetch-smoke-gguf.mjs
```

The script downloads that exact Hugging Face URL, checks the byte count and SHA-256, and writes `models/SmolLM2-135M-Instruct-Q4_K_M.gguf` unless `POCKET_GGUF_DIR` is set. A matching file is not downloaded again.

## 2. Start llama-server on loopback

Install `llama-server` yourself (a llama.cpp build that can load a GGUF). Then print the command the repo will accept:

```bash
node scripts/local-gguf/print-llama-server-command.mjs
```

The script prints a shell-quoted command. With the defaults, from the checkout root, that command loads `models/SmolLM2-135M-Instruct-Q4_K_M.gguf` on `127.0.0.1:8080` with context `8192`:

```bash
llama-server -m models/SmolLM2-135M-Instruct-Q4_K_M.gguf --host 127.0.0.1 --port 8080 -c 8192
```

`LLAMA_SERVER_BIN`, `POCKET_GGUF_PATH`, `LLAMA_SERVER_HOST`, and `LLAMA_SERVER_PORT` override those pieces. A non-loopback host is rejected unless `POCKET_LAB_ALLOW_REMOTE_LLAMA=1`. Leave that unset for local use.

Readiness is HTTP 200 from `GET http://127.0.0.1:8080/health` with a JSON body whose status is `ok`.

## 3. Start the web app

From `apps/web/server.mjs`, the process defaults are `HOST=127.0.0.1` and `PORT=4173`. The provider defaults are llama.cpp `/completion` at `http://127.0.0.1:8080`. Chat and agent calls send the stage JSON Schema as `json_schema`. Returned text is validated again. Malformed model output is rejected, and no analysis string is invented. APEX authorization stays unavailable until real trust, RLS, and schema contracts exist.

`POST /api/chat`, `/api/memory`, and `POST /api/agent-tasks` each have an in-process limit. The defaults are 30, 120, and 8 requests per 60 seconds, counted separately. A request past the limit returns HTTP 429 with `authorized: false` and does not call the model or invent a reply. A blank, zero, or non-numeric limit keeps the default. Counters live in the server process and clear on restart. The app still binds to loopback by default, and memory routes still refuse a non-loopback app host. This guard is not authentication and not a production deployment.

| Variable | Role |
|---|---|
| `LLAMACPP_BASE_URL` | llama-server origin. "Local model ready" requires this health check to succeed on a loopback URL. |
| `LLAMACPP_API` | `completion` (default) or `openai-chat`. |
| `LLAMACPP_MODEL_ALIAS` | Optional alias. `LLM_MODEL` is the legacy name for the same alias. |
| `LLM_BASE_URL` | Legacy origin. A path ending in `/v1` selects `openai-chat` and that suffix is removed. |
| `HOST` | App bind address. Default `127.0.0.1`. Memory routes refuse a non-loopback app host. |
| `PORT` | App port. Default `4173`. |
| `POCKET_MEMORY_DIR` | Optional memory directory. Default `~/.pocket-ai-lab`. |
| `POCKET_RATE_LIMIT_CHAT` | `POST /api/chat` requests allowed per window. Default `30`. |
| `POCKET_RATE_LIMIT_MEMORY` | `/api/memory` requests allowed per window. Default `120`. |
| `POCKET_RATE_LIMIT_AGENT` | `POST /api/agent-tasks` requests allowed per window. Default `8`. |
| `POCKET_RATE_LIMIT_WINDOW_MS` | Window length in milliseconds. Default `60000`. |

`LLM_API_KEY` is not read by the web server or the llama.cpp adapter. Do not put a key in the browser.

```bash
LLAMACPP_BASE_URL=http://127.0.0.1:8080 npm run start:web
```

Open `http://127.0.0.1:4173`. Chat shows the model's `analysis` string only when the provider returns that JSON object. A missing or rejected payload does not invent a reply.

## 4. Optional live smoke record

With llama-server already running on loopback:

```bash
POCKET_GGUF_SMOKE=1 LLAMACPP_BASE_URL=http://127.0.0.1:8080 node scripts/local-gguf/smoke-accept.mjs
```

The command is skipped unless `POCKET_GGUF_SMOKE=1`, and it refuses a non-loopback base URL. It records `/health` and one constrained `/completion`. `productSchemaAccepted` is true only when `content` parses as an object with a non-empty `analysis` string and no extra fields. A true value there is still not authorization. The process exits non-zero when that schema check fails. `npm test` does not download a GGUF and does not require a live server.

`POCKET_E2E=1` with `POCKET_MEMORY_DIR` set to an empty directory runs `npm run e2e:local` against the app on `127.0.0.1`. That checks health, chat, explicit memory, and the agent stream. It does not test another computer. Use `tsx` (the npm script does). Plain `node` cannot load the TypeScript adapter.

`node scripts/local-gguf/build-test-bundle.mjs /opt/cursor/artifacts/pocket-ai-lab-local-test-bundle.tar.gz` writes a reference archive of scripts and docs. The archive excludes weights, `node_modules`, and `.env` files.

Passing this smoke check on one computer does not accept the model on another computer, on iPhone, or as a product release.

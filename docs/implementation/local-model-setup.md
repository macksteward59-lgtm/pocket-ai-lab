# Local model setup

This is the loopback smoke path. It is not iPhone hardware acceptance, not a trained EAGLE-3 accelerator, and not an APEX authorization. A completion from llama-server is untrusted text. The smoke record sets `authorized` and `hardwareAcceptance` to false.

Paths below are relative to a checkout. A directory chosen with `POCKET_GGUF_DIR` on one machine is not a path on another machine. Do not commit `*.gguf` files. `models/` is gitignored.

## 1. Fetch the pinned smoke GGUF

The pin is `scripts/local-gguf/pin.json`:

| Field | Value |
|---|---|
| File | `SmolLM2-135M-Instruct-Q4_K_M.gguf` |
| Repo | `bartowski/SmolLM2-135M-Instruct-GGUF` |
| Revision | `09816acd5d99df7be770d85ea30822623dab342c` |
| SHA-256 | `2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d` |
| Bytes | `105454432` |
| License | `apache-2.0` |
| Base model | `HuggingFaceTB/SmolLM2-135M-Instruct` |

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

The script prints a shell-quoted command. With the defaults, from the checkout root, that command loads `models/SmolLM2-135M-Instruct-Q4_K_M.gguf` on `127.0.0.1:8080` with context `2048`:

```bash
llama-server -m models/SmolLM2-135M-Instruct-Q4_K_M.gguf --host 127.0.0.1 --port 8080 -c 2048
```

`LLAMA_SERVER_BIN`, `POCKET_GGUF_PATH`, `LLAMA_SERVER_HOST`, and `LLAMA_SERVER_PORT` override those pieces. A non-loopback host is rejected unless `POCKET_LAB_ALLOW_REMOTE_LLAMA=1`. Leave that unset for local use.

Readiness is HTTP 200 from `GET http://127.0.0.1:8080/health` with a JSON body whose status is `ok`.

## 3. Start the web app

From `apps/web/server.mjs`, the process defaults are `HOST=127.0.0.1` and `PORT=4173`. The provider defaults are llama.cpp `/completion` at `http://127.0.0.1:8080`.

| Variable | Role |
|---|---|
| `LLAMACPP_BASE_URL` | llama-server origin. "Local model ready" requires this health check to succeed on a loopback URL. |
| `LLAMACPP_API` | `completion` (default) or `openai-chat`. |
| `LLAMACPP_MODEL_ALIAS` | Optional alias. `LLM_MODEL` is the legacy name for the same alias. |
| `LLM_BASE_URL` | Legacy origin. A path ending in `/v1` selects `openai-chat` and that suffix is removed. |
| `HOST` | App bind address. Default `127.0.0.1`. Memory routes refuse a non-loopback app host. |
| `PORT` | App port. Default `4173`. |
| `POCKET_MEMORY_DIR` | Optional memory directory. Default `~/.pocket-ai-lab`. |

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

The command is skipped unless `POCKET_GGUF_SMOKE=1`, and it refuses a non-loopback base URL. It records `/health` and one `/completion`. `productSchemaAccepted` is true only when that completion's `content` parses as a JSON object with a non-empty `analysis` string. A true value there is still not authorization. `npm test` does not download a GGUF and does not require a live server.

Passing this smoke check on one computer does not accept the model on another computer, on iPhone, or as a product release.

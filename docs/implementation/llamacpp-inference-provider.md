# llama.cpp InferenceProvider

The adapter in `runtime/adapters/llama-cpp` implements `InferenceProvider` against a **local** [llama.cpp](https://github.com/ggml-org/llama.cpp) `llama-server`. It uses HTTP only, so the repo does not take a native addon. A future native binding can implement `LlamaCppBackend` and be passed to `createLlamaCppInferenceProvider` without changing the orchestrator.

Core modules do not import this adapter. Construct it at the composition root and inject it.

Model output stays untrusted. `evidenceRefs`, `confidence`, and a verification `verified` flag are copied only when the model returned them. They are not APEX receipts, approvals, or permissions.

## Run llama-server

Build or install `llama-server` (some builds still name the binary `server`), then load a local GGUF. The pinned public smoke file, checksum, and loopback command are in `docs/implementation/local-model-setup.md`. A generic server start is:

```bash
llama-server -m ./models/model.gguf --host 127.0.0.1 --port 8080 -c 4096
```

Check readiness:

```bash
curl -sS http://127.0.0.1:8080/health
```

A ready server responds with HTTP 200 and `{"status":"ok"}`.

The default API mode is native `POST /completion`. The loaded GGUF is the model that runs. `modelAlias` is not required for that mode.

To use the OpenAI-compatible route instead:

```ts
createLlamaCppInferenceProvider({
  baseUrl: "http://127.0.0.1:8080",
  api: "openai-chat",
  modelAlias: "model.gguf" // must match the id from GET /v1/models
});
```

That mode posts to `POST /v1/chat/completions`. When `modelAlias` is omitted, the adapter sends `InferenceRequest.modelId`.

## Inject the provider

On current `main`, inference is optional and `text` is what the orchestrator reads:

```ts
import { Orchestrator } from "./packages/intelligence/orchestrator/Orchestrator";
import { createLlamaCppInferenceProvider } from "./runtime/adapters/llama-cpp/index";

const inference = createLlamaCppInferenceProvider({
  baseUrl: "http://127.0.0.1:8080",
  timeoutMs: 120_000,
  temperature: 0.2,
  maxTokens: 1024
});

await inference.checkHealth();
const orchestrator = new Orchestrator({ inference });
```

Draft PR #1 (`codex/gate-0-1-agent-engine`) requires both `inference` and `getResources`, and it reads `payload` instead of `text`. The same provider instance satisfies that constructor because each call returns both fields from one backend response:

```ts
const orchestrator = new Orchestrator({
  inference,
  getResources: () => ({ availableMemoryMB: 4096, loadedModels: [] })
});
```

Do not import the adapter from `Orchestrator`, `DeliberationEngine`, `MessageBus`, or `ModelRouter`.

`registerLlamaCppInferenceProvider(registry, config)` can place the factory on a caller-owned registry under the id `"llama.cpp"`.

## Config

| Field | Default | Rules |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:8080` | `http` or `https` URL with a host |
| `modelAlias` | omitted | Optional non-empty string, at most 256 characters |
| `timeoutMs` | `120000` | Integer from 1 through 600000 |
| `temperature` | `0.2` | Finite number from 0 through 2 |
| `maxTokens` | `1024` | Integer from 1 through 32768. Sent as `n_predict` or `max_tokens` |
| `stop` | omitted | Up to 16 non-empty strings |
| `seed` | omitted | Integer from 0 through 2147483647. Omitted means the server chooses |
| `api` | `"completion"` | `"completion"` or `"openai-chat"` |

Invalid config throws `LlamaCppInferenceError` with code `invalid_config` at construction time.

## What the model must return

The prompt asks for one JSON object for the deliberation stage. The adapter parses that object and checks it against the PR #1 stage payload schema (`analysis`, `question`, `counterargument`, `revision`, `validation`, or `completion`). A markdown fence around the object is accepted. Prose, arrays, empty text, and objects that fail the schema are errors.

`text` is the backend string unchanged. `payload` is the parsed object. The adapter does not replace a failed call with placeholder text.

## Failures

`LlamaCppInferenceError.code`:

| Code | When |
|---|---|
| `invalid_config` | Config failed validation |
| `invalid_request` | Missing prompt/ids, unknown stage, or `contextMessages` is not an array |
| `backend_unreachable` | TCP/DNS failure or the process is not listening |
| `timeout` | The configured deadline elapsed |
| `cancelled` | The caller's `AbortSignal` aborted |
| `http_error` | HTTP status outside 2xx. `status` is set. The body is not returned as a result |
| `malformed_response` | Non-JSON body, missing content, event stream, or payload schema mismatch |
| `empty_output` | Blank model text |

Cancellation is an optional second argument, `{ signal }`, because `InferenceProvider.generate` does not take an `AbortSignal` yet. Timeouts use an internal signal.

`checkHealth()` calls `GET /health` and resolves only for HTTP 200 with status `ok`.

## Local harness

This is not the consumer product shell. It is a loopback page that runs the adapter through the existing message bus and deliberation engine.

```bash
node scripts/local-gguf/print-llama-server-command.mjs
npm run lab
```

Open http://127.0.0.1:8787. The page talks only to a llama-server on this machine unless `POCKET_LAB_ALLOW_REMOTE_LLAMA=1` is set. A director completion is shown only when the model returns one. The page always reports `authorized: false`.

The model has to return the stage JSON object (`analysis`, `question`, `counterargument`, `revision`, `validation`, then `completion`). If a stage is malformed, the transcript stops there and no completion is invented.

## Tests

```bash
npm test
```

Adapter tests use a local fake HTTP server. No GGUF is downloaded.

To run one live call against a server you already started:

```bash
LLAMACPP_BASE_URL=http://127.0.0.1:8080 npm test
```

Optional: `LLAMACPP_API=completion|openai-chat` and `LLAMACPP_MODEL` (registry model id). The live test is skipped when `LLAMACPP_BASE_URL` is unset. The model must return the `independent` stage JSON object (`{"analysis":"..."}`).

## Native binding later

Implement `LlamaCppBackend` (`complete` and `health`) and pass it as the second argument:

```ts
createLlamaCppInferenceProvider({ temperature: 0.2 }, nativeBackend);
```

The HTTP client stays the default. Orchestration code does not change.


## Chat templates, streaming, and repair (2026-11-08)

New optional `LlamaCppProviderConfigInput` fields, all off or unchanged by default so existing callers behave the same:

| Field | Default | Effect |
|---|---|---|
| `promptFormat` | `"flat"` | `"chat"` builds system/user/assistant messages. In `completion` mode the backend renders them with `POST /apply-template` and falls back to the flat prompt if that fails (404/405/501 are cached as unsupported). `openai-chat` sends the messages directly. |
| `chatOutput` | `"json"` | `"text"` lets chat requests (`agentId: "chat"`) answer in prose with no `json_schema`; the trimmed text becomes `{"analysis": text}` and is validated by the same Zod schema. Empty output throws `empty_output`. |
| `repairAttempts` | `0` | After `malformed_response` or `empty_output`, re-asks the model with the rejection reason, at a slightly higher temperature. Still throws when every attempt fails. |
| `agentMaxTokens` | unset | Lower token cap for agent stages. |
| `requireSubstantive` | `false` | Rejects agent output whose main text is only ids, a word or two, or an echo of the instructions. |
| `aliasMessageIds` | `false` | Shows the model `M1`, `M2`, ... instead of UUIDs (prompt, messages, and schema enums) and maps `addressesMessageIds` / `evidenceRefs` back before validation. Unknown labels are left as-is, so the uuid schema still fails closed. |

`InferenceRequest` gains optional `conversation` (earlier chat turns) and `memoryContext` (unverified user notes). `generateStream(request, { signal, onPreview, onRetry })` streams over SSE when the backend implements `completeStream`; the preview is display-only and the final payload is validated exactly like `generate`. `serverInfo()` reads `GET /props` for the model file name and context length.

Synthesis and challenge `evidenceRefs` are constrained to transcript message ids, arrays have `maxItems`, and text fields have `minLength`/`maxLength`, so constrained decoding cannot loop until the token limit.

None of this changes the trust boundary: model output is never authorization, `authorized` stays `false`, and nothing is invented when output is rejected. The consumer web server does not set these options, so that app still uses the flat JSON prompt. `MemoryManager.search` ranks saved notes locally and does not mark them verified. Passing `memoryContext` does not grant anything.


## Director native function calling

The Director has a separate provider adapter for native OpenAI-style function calls. It is not the stage-based `InferenceProvider` and does not make ordinary chat or deliberation output executable.

Start `llama-server` with `--jinja` and a model/chat template that supports function calling:

```bash
llama-server -m ./models/model.gguf --host 127.0.0.1 --port 8080 -c 8192 --jinja
```

The current llama.cpp function-calling documentation describes OpenAI-style function calling on `llama-server` with `--jinja`, including native handlers for supported model formats and a generic handler for other templates. Generic handling can consume more tokens and may be less efficient. The loaded model and template still determine call quality.

Compose the provider with the bounded task runner and the existing command router:

```ts
import { DirectorCommandRouter } from "../../packages/intelligence/director/DirectorCommandRouter";
import { DirectorTaskRunner } from "../../packages/intelligence/director/DirectorTaskRunner";
import { LlamaCppDirectorCommandProvider } from "./runtime/adapters/llama-cpp";

const commandProvider = new LlamaCppDirectorCommandProvider({
  api: "openai-chat",
  baseUrl: "http://127.0.0.1:8080",
  modelAlias: "model.gguf", // use the id returned by GET /v1/models
  timeoutMs: 120_000,
  maxTokens: 1024
});

// Compose this once with the host-injected DirectorCapabilities and ToolDirector.
declare const directorCommandRouter: DirectorCommandRouter;
const taskRunner = new DirectorTaskRunner(directorCommandRouter, { maxSteps: 8 });
const result = await taskRunner.run(commandProvider, { taskId }, objective);
```

The adapter sends one `director_command` function definition with `tool_choice: "required"` and accepts exactly one matching function call. The required choice is a request to the model/template, not a substitute for validation: some llama.cpp template/model combinations may still return prose or no tool call. In that case, the adapter fails closed. Missing, multiple, malformed, or unexpected calls are rejected. It is non-streaming and requires `api: "openai-chat"` plus an explicit `modelAlias`; the native `/completion` API is not used for function calls.

The function arguments remain untrusted proposals. `DirectorTaskRunner` checks the command kind and task-control shape, `DirectorCommandRouter` validates the command again, and capability ports independently enforce approvals. A model-generated `approvalRef` is not itself approval. Tool execution, device access, memory changes, and tool lifecycle actions still require their existing host-side authorization.

The provider passes only the latest eight bounded history entries to the model and labels tool results as untrusted data. The runner remains the authoritative step limit and terminal-state controller. This adapter does not add persistent task state, cancellation, parallel tool calls, or a production sandbox/provider runtime.

# Pocket AI Lab

**Hybrid offline-first multi-agent intelligence platform.** Agents collaborate to determine what should happen; APEX/East authorization and evidence infrastructure determines what is permitted to happen.

## Consumer prototype (web/PWA)

The first usable application shell lives in `apps/web/`. It includes a responsive workspace, chat UI, live Agent Team runner, model connection status, settings, and transparent memory/activity sections. Chat and Agent Team both call the local llama.cpp `InferenceProvider`. Chat shows the model's `analysis` text and fails closed when that text is missing. Agent Team streams the real multi-agent stages. Neither view invents a reply.

### Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run start:web
```

Open `http://localhost:4173`.

To connect a local llama.cpp server, configure the app host environment:

```bash
LLAMACPP_BASE_URL=http://127.0.0.1:8080 npm run start:web
```

`LLAMACPP_API` is `completion` by default, or `openai-chat` for `/v1/chat/completions`. A legacy `LLM_BASE_URL` that ends in `/v1` selects `openai-chat` and is not given an API key by this adapter. The browser never stores the endpoint. "Local model ready" is shown only after `GET /health` succeeds on a loopback URL. Do not expose a network-reachable app server without authentication, TLS, and deployment hardening.

```bash
npm test
npm run build
```

The PWA caches its static shell and icon for offline launch. Inference still requires a reachable local provider.

### Consumer memory

The Memory screen supports explicit user-initiated save, list, edit, and delete through `MemoryManager` backed by `FileMemoryStore`. Editing preserves the entry ID and creation time, changes content/source references only, and resets verification to `false`. Chat is never auto-saved; no model-driven verification is offered. On POSIX systems, the memory directory and file are restricted to owner access. The file is checksummed plaintext, **not encrypted at rest**; do not store passwords, tokens, or other secrets. The memory API is enabled only when the app is configured to bind to loopback and the request originates from a loopback client. `POCKET_MEMORY_DIR` can override the default `~/.pocket-ai-lab` directory.

## Local llama.cpp adapter

A separate `InferenceProvider` lives in `runtime/adapters/llama-cpp`. Core orchestration does not import it. The consumer Agent Team view and the loopback harness both run multi-stage sessions through the existing message bus and deliberation engine. The harness remains a developer surface; neither UI authorizes anything.

```bash
node scripts/local-gguf/fetch-smoke-gguf.mjs
node scripts/local-gguf/print-llama-server-command.mjs
npm run lab
```

The fetch writes a gitignored GGUF. Open http://127.0.0.1:8787. Exact env vars, the pinned checksum, and the difference between a loopback smoke check and hardware acceptance: `docs/implementation/local-model-setup.md`. Adapter behavior: `docs/implementation/llamacpp-inference-provider.md`. The experimental EAGLE-3 scaffold is untrained and is not this GGUF: `docs/implementation/eagle3-scaffold.md`.

```ts
import { Orchestrator } from "./packages/intelligence/orchestrator/Orchestrator";
import { createLlamaCppInferenceProvider } from "./runtime/adapters/llama-cpp/index";

const inference = createLlamaCppInferenceProvider({ baseUrl: "http://127.0.0.1:8080" });
const orchestrator = new Orchestrator({
  inference,
  getResources: () => ({ availableMemoryMB: 4096, loadedModels: [] })
});
orchestrator.models.register({
  id: "local", name: "Local llama.cpp", path: "llama-server",
  contextLength: 4096, capabilities: ["reason", "code"], memoryEstimateMB: 1024
});
for (const agentId of ["director", "reasoner", "researcher", "engineer", "critic", "validator"]) {
  orchestrator.models.associateAgent(agentId, "local");
}
```

Model text is untrusted proposal data. It is not an APEX approval or receipt.

## Architecture principles

1. **Model independence** — Agents are roles, instructions, and permission profiles, not tied to a single model.
2. **Collective intelligence** — Independent analysis → challenge → revision → validation → synthesis.
3. **Governed autonomy** — Permanent core team + dynamic specialists; consequential actions must pass the independent APEX authorization path.
4. **Honest product states** — A role is not represented as an active inference agent until a real provider call occurs. Model text is not verification or authorization.

## Implementation status

| Area | Status |
|---|---|
| Architecture and trust invariants | Documented |
| Multi-agent TypeScript foundation | Implemented; requires integration and production hardening |
| llama.cpp provider | HTTP adapter and loopback harness are in this tree. A pinned SmolLM2 135M Q4_K_M smoke download is documented. Consumer chat and Agent Team both call the adapter. A smoke run is not hardware acceptance. |
| EAGLE-3 scaffold | Experimental untrained Python shape and tree mask only. Not a native Llama draft model, not TorchSpec, and not vLLM or SGLang acceleration. |
| APEX evidence | Candidate validation only. `candidate_only` is not authorization. Trust, RLS, and schema contracts are still absent. See `docs/implementation/apex-evidence-handoff.md`. |
| Consumer web/PWA shell | On main. Chat returns the provider's `analysis` text. "Local model ready" requires a successful loopback health check. |
| Portable desktop launcher | `scripts/desktop/` starts the loopback app and can build an archive. Node and llama-server remain prerequisites. No model is bundled. Windows and macOS scripts are untested. See `docs/implementation/desktop-launcher.md`. |
| Governance-as-Review | Non-executing sidecar and watcher. Scanner exports are parsed and scoped. `authorized` stays false. See `docs/implementation/governance-as-review.md`. |
| Agent collaboration UI and live multi-agent execution | Consumer Agent Team view streams real local agent stages; production orchestration hardening remains |
| Consumer memory controls | Explicit local save/list/delete connected to `MemoryManager` + `FileMemoryStore`; user opt-in only, unverified by default, plaintext at rest |
| East/APEX runtime integration | Not yet complete |
| Native iOS local inference | Gate 2 links pinned llama.cpp `b12233` (`5f490d7bfe78844e6390c869454c149fd7e003a8`) with Metal. The placeholder still throws `backendUnavailable`. `LlamaCppMetalBackend` throws that same error when llama.cpp is not linked or Metal cannot initialize, and it returns only text llama.cpp produced. GitHub's arm64 macOS pool did not assign a runner (run 42692199700). CI is configured on the hosted Intel `macos-15-intel` image to cross-build physical iOS arm64, the available simulator slice, and macOS, then assemble XCFrameworks; it runs simulator XCTest, checks a SmolLM2 GGUF SHA-256, and runs a host smoke generation. A green hosted Intel job is still not an Apple Silicon Mac run or a physical iPhone run. See `docs/implementation/ios-llamaengine-gate2.md`. |
| Production deployment, auth, telemetry, release pipeline | Not yet complete |

## Trust invariants (must never break)

- A model cannot grant itself permission.
- An agent cannot approve its own consequential action.
- Agent messages are not authorization receipts.
- Individual generation evidence is preserved; parent task evidence references it.
- Unauthorized actions are denied by APEX.
- Repair operations require independent authorization.

See `docs/architecture/Pocket-AI-Lab-Multi-Agent-Intelligence-Architecture-v1.0.md` and `docs/implementation/consumer-prototype-acceptance.md` for the architecture and measurable product acceptance criteria.

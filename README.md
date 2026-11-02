# Pocket AI Lab

**Hybrid offline-first multi-agent intelligence platform.** Agents collaborate to determine what should happen; APEX/East authorization and evidence infrastructure determines what is permitted to happen.

## Consumer prototype (web/PWA)

The first usable application shell lives in `apps/web/`. It includes a responsive workspace, chat UI, live Agent Team runner, model connection status, settings and transparent memory/activity sections. Chat uses a server-configured OpenAI-compatible endpoint; Agent Team uses the local llama.cpp InferenceProvider and streams real multi-agent stages. Both fail closed when no model is available.

### Run locally

Requires Node.js 22 or newer.

```bash
npm install
npm run start:web
```

Open `http://localhost:4173`.

To connect a local llama.cpp server, configure the app host environment:

```bash
LLM_BASE_URL=http://127.0.0.1:8080/v1
LLM_MODEL=your-loaded-model
# Optional; keep credentials server-side only.
LLM_API_KEY=your-local-provider-key
npm run start:web
```

The chat server calls the configured OpenAI-compatible `/chat/completions` endpoint. Provider URLs and credentials are controlled by the server environment, not browser storage. The Agent Team view uses `LLAMACPP_BASE_URL` (default `http://127.0.0.1:8080`) and `LLAMACPP_API` (`completion` by default or `openai-chat`). Do not expose a network-reachable app server without authentication, TLS, and deployment hardening.

```bash
npm test
npm run build
```

The PWA caches its static shell and icon for offline launch. Inference still requires a reachable local provider.

## Local llama.cpp adapter

A separate `InferenceProvider` lives in `runtime/adapters/llama-cpp`. Core orchestration does not import it. The consumer Agent Team view and the loopback harness both run multi-stage sessions through the existing message bus and deliberation engine. The harness remains a developer surface; neither UI authorizes anything.

```bash
llama-server -m ./models/model.gguf --host 127.0.0.1 --port 8080 -c 4096
npm run lab
```

Open http://127.0.0.1:8787. Setup and failure behavior: `docs/implementation/llamacpp-inference-provider.md`.

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
| llama.cpp provider | HTTP adapter and loopback harness are in this tree; consumer Agent Team view now calls the adapter. iOS LlamaEngine is still a stub. |
| Consumer web/PWA shell | On main. Chat uses a server-side OpenAI-compatible proxy, not `InferenceProvider` yet. |
| Agent collaboration UI and live multi-agent execution | Consumer Agent Team view streams real local agent stages; production orchestration hardening remains |
| Durable, governed memory | Not yet connected |
| East/APEX runtime integration | Not yet complete |
| Native iOS local inference | Placeholder; not consumer-ready |
| Production deployment, auth, telemetry, release pipeline | Not yet complete |

## Trust invariants (must never break)

- A model cannot grant itself permission.
- An agent cannot approve its own consequential action.
- Agent messages are not authorization receipts.
- Individual generation evidence is preserved; parent task evidence references it.
- Unauthorized actions are denied by APEX.
- Repair operations require independent authorization.

See `docs/architecture/Pocket-AI-Lab-Multi-Agent-Intelligence-Architecture-v1.0.md` and `docs/implementation/consumer-prototype-acceptance.md` for the architecture and measurable product acceptance criteria.

# Pocket AI Lab

**Hybrid offline-first multi-agent intelligence platform.**

Agents collaborate to determine *what should happen*.  
Existing APEX / East authorization and evidence infrastructure determines *what is permitted to happen*.

## Architecture Principles

1. **Model independence** — Agents are roles + instructions + permissions, not tied to a single model.
2. **Collective intelligence** — Independent analysis → challenge → revision → validation → synthesis.
3. **Governed autonomy** — Permanent core team + dynamic specialists; all consequential actions pass APEX.

## Structure

```
pocket-ai-lab/
├── apps/                  # (future) Native iOS app
├── packages/
│   ├── director/          # Existing APEX governance & orchestration
│   ├── exploitgym/        # Existing cybersecurity evaluation
│   ├── grok/              # Existing workspace & artifacts
│   ├── east/              # East/e3 foundation
│   └── intelligence/      # New multi-agent engine
│       ├── agents/        # AgentManager + core team
│       ├── orchestrator/  # Director coordination
│       ├── model-registry/
│       ├── model-router/
│       ├── message-bus/   # Typed AgentMessage protocol
│       ├── deliberation/
│       ├── memory/        # 4-layer + provenance
│       ├── knowledge/
│       ├── evaluation/
│       ├── policies/
│       └── telemetry/
├── runtime/
│   └── ios/               # LlamaEngine protocol + stubs
├── src/east/              # e3 durable task package
└── docs/
    ├── architecture/      # Full v1.0 specification
    ├── agent-contracts/
    └── implementation/
```

## Quick Start

```bash
npm install
npm run build
# Full local inference (Gate 1) requires llama.cpp Metal bindings in runtime/ios
```

## Implementation Status

| Gate | Description                  | Status                                      |
|------|------------------------------|---------------------------------------------|
| 0    | Architecture audit           | Done                                        |
| 0.1  | Corrective engineering pass  | In progress (inference interface, immutable messages, honest consensus, non-auto-verified memory) |
| 1    | Local inference (llama.cpp)  | Local llama-server HTTP adapter in `runtime/adapters/llama-cpp` (iOS LlamaEngine is still a stub) |
| 2    | Multi-model registry         | Implemented                                 |
| 3    | Agent orchestration          | Core done (placeholder inference)           |
| 4    | Deliberation                 | Engine improved (no forced consensus)       |
| 5    | Shared memory                | Layers ready + optional persistence backend |
| 6    | East/APEX integration        | Tasks defined; platform fns still to implement |
| 7    | Full Pocket AI Lab UI        | Next                                        |

## Trust Invariants (must never break)

- A model cannot grant itself permission.
- An agent cannot approve its own consequential action.
- Agent messages are not authorization receipts.
- Individual generation evidence is preserved; parent task evidence references them.
- Unauthorized actions are denied by APEX.

See `docs/architecture/Pocket-AI-Lab-Multi-Agent-Intelligence-Architecture-v1.0.md` for the complete engineering specification.

## Local llama.cpp inference

The Node adapter talks to a local `llama-server` over HTTP. It implements `InferenceProvider` and is constructed outside the orchestrator, so core inference stays model-independent.

```bash
llama-server -m ./models/model.gguf --host 127.0.0.1 --port 8080 -c 4096
```

```ts
import { Orchestrator } from "./packages/intelligence/orchestrator/Orchestrator";
import { createLlamaCppInferenceProvider } from "./runtime/adapters/llama-cpp/index";

const inference = createLlamaCppInferenceProvider({ baseUrl: "http://127.0.0.1:8080" });
const orchestrator = new Orchestrator({ inference });
```

Model text is untrusted proposal data. It is not an APEX approval or receipt. Setup, config, and failure behavior: `docs/implementation/llamacpp-inference-provider.md`.

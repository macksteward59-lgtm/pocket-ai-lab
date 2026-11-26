# Pocket AI Lab

**Hybrid offline-first multi-agent intelligence platform.**

Agents collaborate to determine *what should happen*.  
Existing APEX / East authorization and evidence infrastructure determines *what is permitted to happen*.

## Architecture Principles

1. **Model independence** — Agents are roles + instructions + permissions, not tied to a single model.
2. **Collective intelligence** — Independent analysis → challenge → revision → validation → synthesis.
3. **Governed autonomy** — Permanent core team + dynamic specialists; all consequential actions pass APEX.

## Structure

\`\`\`
pocket-ai-lab/
├── apps/                  # (future) Native iOS app
├── packages/
│   ├── director/          # Existing APEX governance & orchestration
│   ├── exploitgym/        # Existing cybersecurity evaluation
│   ├── grok/              # Existing workspace & artifacts
│   ├── east/              # East/e3 foundation
│   └── intelligence/      # Multi-agent engine
│       ├── agents/        # AgentManager + core team
│       ├── orchestrator/  # Injected inference + stage execution
│       ├── model-registry/
│       ├── model-router/  # Fail-closed model/resource checks
│       ├── message-bus/   # Typed, deeply frozen AgentMessage protocol
│       ├── deliberation/  # Bounded challenge/revision/validation
│       ├── memory/        # 4-layer + provenance
│       ├── knowledge/
│       ├── evaluation/
│       ├── policies/
│       └── telemetry/
├── runtime/
│   └── ios/               # LlamaEngine protocol + current stubs
├── src/east/              # e3 durable task package
└── docs/
    ├── architecture/      # Full v1.0 specification
    ├── agent-contracts/
    └── implementation/
\`\`\`

## Quick Start

\`\`\`bash
npm install
npm run build
npm test
\`\`\`

A real InferenceProvider, registered model assignments, and a live resource provider are required before Orchestrator.executeTask() can run. The orchestration layer intentionally has no fake default model or placeholder inference.

## Implementation Status

| Gate | Description | Status |
|---|---|---|
| 0 | Architecture audit | Completed |
| 0.1 | Runtime correctness + test foundation | In progress on codex/gate-0-1-agent-engine |
| 1 | Local inference (llama.cpp) | Not integrated; LlamaEngine remains a stub |
| 2 | Multi-model registry | Basic registry implemented; runtime model loading not verified |
| 3 | Agent orchestration | Stage execution wired to injected provider; provider and model assignments still required |
| 4 | Deliberation | Bounded stages, typed outputs, objection tracking, validator-gated consensus |
| 5 | Shared memory | In-process layers; durable persistence not verified |
| 6 | East/APEX integration | Task contracts exist; platform functions still require implementation and verification |
| 7 | Full Pocket AI Lab UI | Not implemented |

## Gate 0.1 Runtime Contract

- Each stage invokes only its assigned agent roles and passes the prior task thread as context.
- Each model response must match the stage's typed message payload. Invalid output is rejected by the message bus.
- Published messages and nested payloads are deeply frozen.
- Model routing requires an explicitly registered model, a configured runtime path, required capabilities, and sufficient reported memory. It does not invent a fallback model or wait indefinitely.
- A counterargument remains unresolved until a revision explicitly references its message ID.
- Consensus requires no unresolved counterarguments and an affirmative message from the Validator. Silence is not consensus.
- Synthesis is accepted only from the Director completion message.
- Memory records the synthesis as unverified. This layer does not authorize actions or issue APEX receipts.

These controls improve the orchestration contract; they do **not** establish that llama.cpp, APEX, East platform functions, persistent memory, or native iOS inference are operational.

## Trust Invariants (must never break)

- A model cannot grant itself permission.
- An agent cannot approve its own consequential action.
- Agent messages are not authorization receipts.
- Individual generation evidence is preserved; parent task evidence references them.
- Unauthorized actions are denied by APEX.

See docs/architecture/Pocket-AI-Lab-Multi-Agent-Intelligence-Architecture-v1.0.md for the broader engineering specification.

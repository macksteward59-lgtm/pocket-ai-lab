# Coordination Board

Ownership is tracked here. A collaborator must push a claim before changing implementation files. Status values for claimed work: `claimed`, `in-progress`, `in-review`, or `done`.

| Owner | Area/files | Branch | Status (claimed/in-progress/in-review/done) | Updated (UTC) | Notes |
|---|---|---|---|---|---|
| ChatGPT | Gate 0.1 agent engine: `packages/intelligence/agents/AgentManager.ts`, `packages/intelligence/deliberation/DeliberationEngine.ts`, `packages/intelligence/message-bus/MessageBus.ts`, `packages/intelligence/model-router/ModelRouter.ts`, `packages/intelligence/orchestrator/Orchestrator.ts`, intelligence tests, `README.md`, `package.json`, `.github/workflows/intelligence-ci.yml`, and `src/east/index.ts` | `codex/gate-0-1-agent-engine` | in-progress | 2026-11-02 08:21 | Unmerged feature branch; comparison with `main` reports 17 commits ahead and 1 behind. No open PR was found in the repository search, and a successful CI run is not confirmed. The East declarations file was touched on this branch before this coordination process existed; review that diff before any merge. |

## Unclaimed work

The following areas have no owner assigned yet. Claim one in this board and push the claim before implementation.

- **llama.cpp InferenceProvider adapter** — implement the adapter behind the existing `InferenceProvider` contract; preserve model independence.
- **East platform functions (declarations only so far)** — implement the platform-side functions; coordinate with the existing declarations and avoid implying that declarations are runtime implementations.
- **Memory persistence hardening** — durable persistence, integrity, lifecycle, and recovery behavior for memory.
- **East/APEX integration** — integration and evidence flow; preserve all APEX trust boundaries and authorization semantics.
- **iOS LlamaEngine** — replace placeholder behavior with a real local inference engine and lifecycle handling.
- **GitHub Actions CI** — establish and verify reliable build/test checks; a workflow file exists on the unmerged ChatGPT feature branch, but a passing end-to-end run is not confirmed.


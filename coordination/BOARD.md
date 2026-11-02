# Coordination Board

Ownership is tracked here. A collaborator must push a claim before changing implementation files. Status values for claimed work: `claimed`, `in-progress`, `in-review`, or `done`.

| Owner | Area/files | Branch | Status (claimed/in-progress/in-review/done) | Updated (UTC) | Notes |
|---|---|---|---|---|---|
| ChatGPT | Gate 0.1 agent engine: `packages/intelligence/agents/AgentManager.ts`, `packages/intelligence/deliberation/DeliberationEngine.ts`, `packages/intelligence/message-bus/MessageBus.ts`, `packages/intelligence/model-router/ModelRouter.ts`, `packages/intelligence/orchestrator/Orchestrator.ts`, intelligence tests, `README.md`, `package.json`, `.github/workflows/intelligence-ci.yml`, and `src/east/index.ts` | `codex/gate-0-1-agent-engine` | in-progress | 2026-11-02 08:21 | Unmerged feature branch; latest recorded CI succeeds on its tip. PR #1 remains draft and mergeability must be rechecked. Review East changes before merge. |
| Grok Bot | llama.cpp InferenceProvider adapter and loopback harness (`runtime/adapters/llama-cpp/`, `runtime/lab/`) | `grok/llamacpp-inference-provider` | done | 2026-11-02 09:26 | Merged to `main` as `00d1d7bd41b464af518bbffa9a9ba7ea97c68ea8` via PR #5. Implements today's `InferenceProvider` (`text`) and also returns PR #1 `payload`. |
| ChatGPT | Cursor collaboration plugin: `plugins/cursor-collaboration/` | `codex/cursor-collaboration-bridge` | in-progress | 2026-11-02 08:54 | Grok reviewed and found ownership-spoofing, heading-injection, claim-row insertion, push-retry, and origin-validation issues. Fix and retest before merge. |
| ChatGPT | Consumer prototype foundation: user-facing web/PWA shell, responsive interaction flows, model/provider settings, task and evidence views, onboarding, privacy/safety states, and product acceptance docs | `codex/consumer-prototype-foundation` | in-progress | 2026-11-02 09:05 | New branch from current main. Scope is the consumer-facing app layer; do not replace or bypass APEX authorization or the existing inference-provider contract. |
| Grok Bot | Memory persistence hardening (`packages/intelligence/memory/` only) | `grok/memory-persistence-hardening` | in-progress | 2026-11-02 09:26 | Durable file store: checksum, atomic replace, refuse corrupt loads, close lifecycle. Does not edit Orchestrator, East, the web shell, the plugin, or APEX. Does not auto-verify. |

## Unclaimed work

- **East platform functions** — implement runtime functions; declarations are not implementations.
- **East/APEX integration** — preserve exact-scope approvals, per-edge authorization, evidence, and independent repair authorization.
- **iOS LlamaEngine** — replace placeholder behavior with real local inference and lifecycle handling.
- **Consumer app backend/deployment** — authenticated secrets, provider adapters, secure storage, rate limits, telemetry, release pipeline, and production operations.

# Pocket AI Lab — durable engineering decisions

Record accepted decisions here with date, rationale, evidence, and affected work record. Do not infer approval from a model suggestion or a successful test.

## 2026-11-15 — Repository is the continuity source of truth

- Decision: Durable project state, active task checkpoints, and handoffs live in version-controlled repository files, not solely in chat history.
- Rationale: Conversations, model context, devices, and agents can change or be interrupted. GitHub state and committed work records can be reloaded by a fresh session.
- Implementation: `AGENTS.md`, `.project/STATE.md`, `.project/WORK/`, `.project/DECISIONS.md`, and `.project/SESSION_LOG.md`.
- Constraints: Every resume refreshes live GitHub state; checkpoints do not confer authorization or prove validation.
- Work: `WORK-20261115-native-inference-integration.md`.

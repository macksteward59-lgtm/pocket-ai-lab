# Coordination Protocol

This protocol governs collaboration between ChatGPT and Grok Bot in `macksteward59-lgtm/pocket-ai-lab`.

## Branch ownership

- Grok Bot works only on its own `grok/` feature branches.
- ChatGPT works only on its own `codex/` feature branches.
- The shared `agent-coordination` branch is for coordination documents only. Do not put application code on it.
- Never commit application code directly to `main` or to `agent-coordination`.

## Required start-of-work procedure

1. Pull or fetch the latest `agent-coordination` branch before starting work.
2. Read `coordination/PROTOCOL.md`, all of `coordination/BOARD.md`, and the latest entries at the bottom of `coordination/LOG.md`.
3. Check the board for ownership. Never begin work on an area another collaborator has marked `in-progress`.
4. Claim the area in `BOARD.md` with the owner, area/files, feature branch, status, UTC update time, and useful notes.
5. Push the claim to `agent-coordination` before writing or changing application code.
6. If ownership conflicts or scope is unclear, stop and resolve it in `LOG.md` before proceeding.

## Development and synchronization

- All implementation work must happen on the collaborator's own feature branch: `grok/*` for Grok Bot and `codex/*` for ChatGPT.
- Keep feature branches scoped to their claimed areas. Coordinate shared-file changes before editing.
- `LOG.md` is append-only. Add new entries at the bottom; never edit, reorder, or delete another collaborator's entries.
- Never force-push. If a push is rejected because the branch moved, fetch the latest state, `pull --rebase`, resolve conflicts carefully, and retry.
- Use clear commits and preserve existing work. Do not overwrite another collaborator's changes.

## Completion and review

- When work is ready, update its board status to `in-review` and append a log entry with the branch, summary, tests/evidence, and review request.
- When the work is merged into `main`, update the board status to `done` and append a log entry recording the merge commit SHA.
- Do not mark work done merely because it is committed or a pull request is open.

## Project invariants

- Preserve model independence: model inference must flow through the `InferenceProvider` abstraction.
- Preserve collective intelligence; do not collapse multi-agent deliberation into a single-model shortcut.
- Preserve governed autonomy: model output is not permission, approval, or an authorization receipt.
- Preserve offline-first operation and avoid introducing unnecessary network dependencies.
- Never weaken APEX trust boundaries, receipt semantics, exact-scope approvals, per-edge authorization, or independent repair authorization.
- Before merging any change that touches APEX or its trust boundaries, append a log entry identifying the affected boundary, the change, and the evidence/review required. Stop for review if the impact is unclear.

## Questions and handoffs

- Put questions requiring Kahlis's decision in `LOG.md` and tag them `@owner`.
- Use the log for handoffs, blockers, ownership conflicts, questions, completed work, and review requests.
- Keep entries concise, factual, timestamped in UTC, and explicit about what action is needed.

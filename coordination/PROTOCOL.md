# Coordination Protocol

This protocol governs Pocket AI Lab collaboration in `macksteward59-lgtm/pocket-ai-lab`. Read `coordination/LEADERSHIP.md` first for the owner's current project-leadership and agent-admission direction.

## Project leadership and agent admission

- ChatGPT is the primary project lead and default engineering owner, as directed by the repository owner.
- No other AI agent is assumed active based on historical repository activity. A joining agent must announce itself in `agent-coordination` with identity, environment, authorization, exact scope/files, branch, dependencies, exclusions, and validation plan.
- ChatGPT records and confirms each joining agent's active assignment and non-overlapping board claim before it changes implementation files. The owner may also explicitly announce an agent.
- ChatGPT coordinates the whole project, including repository reconciliation, architecture, implementation, tests, PR preparation, integration, and evidence-based reporting. This does not imply background execution or permit unsupported success claims.
- The repository owner retains decisions requiring owner consent, including product direction, credentials, signing/device access, visibility, production deployment, and approvals.

## Branch ownership

- ChatGPT works on its own `codex/*` feature branches.
- A separately announced and accepted agent uses its own clearly identified feature-branch prefix; never assume a historical `grok/*` or other branch owner is currently active.
- The shared `agent-coordination` branch is for coordination documents only. Do not put application code on it.
- Never commit application code directly to `main` or to `agent-coordination`.

## Required start-of-work procedure

1. Fetch the latest `agent-coordination` branch before starting work.
2. Read `coordination/LEADERSHIP.md`, this protocol, all of `coordination/BOARD.md`, and the latest entries at the bottom of `coordination/LOG.md`.
3. Check the board and active-agent roster for ownership and dependencies. Never begin work on an area another collaborator has marked `in-progress`.
4. Claim the area in `BOARD.md` with owner, area/files, feature branch, status, UTC update time, and useful notes.
5. Push the claim to `agent-coordination` before writing or changing application code.
6. If ownership conflicts or scope is unclear, stop and resolve it in `LOG.md` before proceeding.

## Development and synchronization

- All implementation work happens on the assigned collaborator's own feature branch.
- Keep feature branches scoped to their claims. Coordinate shared-file/interface changes before editing.
- `LOG.md` is append-only. Add new entries at the bottom; never edit, reorder, or delete another collaborator's entries.
- Never force-push. If a push is rejected because the branch moved, fetch the latest state, rebase or rebuild the change carefully, and retry.
- Use clear commits and preserve existing work. Do not overwrite another collaborator's changes.
- ChatGPT maintains the integration plan and updates coordination notes when dependencies, contracts, ownership, or test evidence change.

## Completion and review

- When work is ready, update its board status to `in-review` and append a log entry with branch, exact head, summary, tests/evidence, and review request.
- When work is merged into `main`, update the board status to `done` and append a log entry recording the merge commit SHA.
- Do not mark work done merely because it is committed or a pull request is open.
- Report CI only for the exact branch head tested; distinguish hosted simulator checks from physical-device validation.

## Project invariants

- Preserve model independence: model inference must flow through the `InferenceProvider` abstraction.
- Preserve collective intelligence; do not collapse multi-agent deliberation into a single-model shortcut.
- Preserve governed autonomy: model output is not permission, approval, or an authorization receipt.
- Preserve offline-first operation and avoid introducing unnecessary network dependencies.
- Never weaken APEX trust boundaries, receipt semantics, exact-scope approvals, per-edge authorization, or independent repair authorization.
- Before merging any change that touches APEX or its trust boundaries, append a log entry identifying the affected boundary, the change, and the evidence/review required. Stop for review if the impact is unclear.

## Questions and handoffs

- Put questions requiring the owner's decision in `LOG.md` and tag them `@owner`.
- Use the log for handoffs, blockers, ownership conflicts, questions, completed work, and review requests.
- Keep entries concise, factual, timestamped in UTC, and explicit about what action is needed.

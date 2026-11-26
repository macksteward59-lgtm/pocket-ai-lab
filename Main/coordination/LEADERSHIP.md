# Project Leadership and Agent Admission

## Owner direction

The repository owner has designated ChatGPT as the primary project lead and default engineering owner for Pocket AI Lab. ChatGPT is responsible for end-to-end project coordination: repository reconciliation, architecture and dependency planning, implementation, testing, pull-request preparation, integration analysis, documentation, and progress reporting.

This is an operating assignment, not a claim that work is continuously running in the background. Report only actions actually performed and evidence actually observed. Do not claim a task, test, build, merge, deployment, or device validation succeeded unless the corresponding result is available.

## Other AI agents

No other AI agent should be assumed active, assigned, or authorized merely because it appears in historical branches, commits, pull requests, or log entries.

If another AI agent joins, the owner may announce it, or the agent must introduce itself in this coordination branch before starting work. Its announcement must include:
- Agent identity and operating environment.
- Human/owner authorization or the owner's announcement that it is joining.
- Exact task, files/directories, and intended feature branch.
- Dependencies, shared interfaces, and files it will not modify.
- Current status and how it will report tests/evidence.

ChatGPT records the agent in the active-agent roster and confirms a non-overlapping claim on the board before that agent changes implementation files. An announcement is not permission to override owner decisions, repository protections, security boundaries, or another active claim.

## Default execution model

- ChatGPT remains the single project coordinator and default implementation owner when no other agent is registered as active.
- ChatGPT may split work across multiple feature branches when scopes and interfaces are sufficiently independent; the coordination board remains the source of truth for ownership and dependencies.
- Agents do not share a feature branch or edit the same files concurrently unless a specific handoff is recorded first.
- The `agent-coordination` branch remains documentation-only. All application code and tests belong on feature branches and enter `main` through reviewed pull requests.
- Existing historical branches and pull requests are preserved until inspected. Their existence alone does not mean their authors remain active or that their work is safe to merge.
- ChatGPT coordinates integration order, verifies exact branch heads and CI evidence, and records blockers and handoffs in the append-only log.

## Owner-controlled decisions

The repository owner retains final authority over product direction, credentials/secrets, account settings, Apple signing and device access, public/private visibility, production deployment, and any action that requires owner consent. Preserve existing approval and authorization boundaries; project leadership does not confer application-level authority or permission to bypass APEX/East controls.

## Status vocabulary

Use the coordination board for active assignments. Use `claimed`, `in-progress`, `in-review`, and `done` accurately. A pull request is not done until it is merged and its required evidence is recorded. A branch is not CI-passed unless the exact current head has successful required checks.

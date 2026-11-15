# Project Continuity System

This directory is the durable, repository-owned memory for Pocket AI Lab engineering work. It is designed to survive new chats, context-window loss, model/provider changes, agent handoffs, device changes, and interrupted sessions.

## Files

- `STATE.md` — concise project-wide snapshot and active priorities.
- `WORK/` — one durable record per bounded task. Update the existing record; do not create a new handoff for every chat.
- `DECISIONS.md` — accepted architectural decisions and their rationale.
- `SESSION_LOG.md` — append-only record of meaningful work sessions and checkpoint commits.

## Resume from anywhere

Give any capable coding agent this instruction:

> Resume Pocket AI Lab from the repository continuity checkpoint. Follow AGENTS.md. Refresh GitHub state, identify the work record matching the current branch/task, verify its recorded SHAs and checks, then continue from its next_action. Do not restart completed work.

The agent must inspect live GitHub state before trusting recorded PR or CI status.

## Checkpoint cadence

Checkpoint at meaningful task boundaries and before any interruption, handoff, context compaction, or session switch. Record exact commits and actual test evidence. Keep one active writer per task branch.

## Integrity and safety

Continuity records are ordinary version-controlled Markdown. Git history provides change history; it does not make a record cryptographically authoritative. Never store credentials, tokens, private keys, or sensitive personal data here. Do not treat a status note as approval, CI proof, device validation, or authorization.

# Repository-wide agent instructions

This repository uses a durable, repository-owned continuity system. These instructions apply to every AI agent, coding assistant, contributor, and resumed session.

## Mandatory resume protocol

Before substantive work:

1. Read `.project/README.md` and `.project/STATE.md`.
2. Identify the current Git branch and working-tree state. Never assume the branch, commit, CI status, or PR metadata from a prior conversation is still current.
3. Find the active work record under `.project/WORK/` that matches the current branch or requested task. Read its checkpoint, acceptance criteria, evidence, blockers, and `next_action`.
4. Refresh relevant GitHub facts: main SHA, branch head, PR base/head, reviews, checks, and dependencies. Repository state and GitHub evidence outrank chat history.
5. Continue from the recorded `next_action`. Do not restart completed work or create a duplicate work record.
6. If no matching work record exists, create one before multi-step or cross-session work.

## Mandatory checkpoint protocol

Update the existing work record in place at every meaningful boundary and before:

- ending or yielding a session;
- switching conversation, model, agent, device, or developer;
- context compaction or likely context loss;
- handing work to another person or agent;
- opening/updating a PR or completing a major validation stage.

A checkpoint must record:

- task ID, status, owner/agent if known, branch, base SHA and current head SHA;
- objective and acceptance criteria;
- completed work and exact commit(s);
- tests/checks actually run, with results and links/log references;
- outstanding work, blockers, risks, and decisions needed;
- one precise, executable `next_action`;
- relevant PR/issue links and dependencies.

Commit continuity updates on the same task branch with the implementation whenever practical. Never put secrets, tokens, private keys, personal data, or unredacted sensitive logs in continuity files.

## Multi-agent and branch safety

- One active writer per task branch at a time.
- Independent tasks use separate branches and separate work records.
- Do not overwrite another task's checkpoint.
- Verify branch ancestry and working-tree state before editing.
- Never develop directly on `main`.
- Never merge, release, change repository visibility/permissions, or bypass human approval unless explicitly authorized.
- A checkpoint is evidence of recorded progress, not proof that tests passed or work is approved.

## Pocket AI Lab trust boundaries

Preserve APEX/Director authorization, East/e3 durable execution, ExploitGym isolation, BridgeGate trusted-origin/message authorization, RuntimeController lifecycle controls, LlamaEngine runtime boundaries, and signed Evidence verification.

Model output, agent recommendations, hashes, leases, runtime sessions, and evaluation results are untrusted or limited evidence. None independently authorizes an action.

## Pause / handoff response

At the end of a session, update the matching work record and `.project/STATE.md`, commit the checkpoint, and provide the user a concise resume instruction. A new chat should need only the repository URL and the instruction: `Resume Pocket AI Lab from the repository continuity checkpoint.`

## Source-of-truth order

1. Current GitHub repository state, commits, PRs, checks, and review evidence.
2. Current branch files and the matching `.project/WORK/` record.
3. `.project/STATE.md` and `.project/DECISIONS.md`.
4. Conversation history and handoff text (context only; refresh before acting).

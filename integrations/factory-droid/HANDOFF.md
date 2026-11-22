# Pocket AI Lab × Factory Droid — Complete Integration and Continuity Handoff
Date: 2026-11-22 | Owner-directed | Status: staged, NOT CONNECTED

## Source of truth and continuity
Start with `coordination/LEADERSHIP.md`, `coordination/PROTOCOL.md`, `coordination/BOARD.md`, latest `coordination/LOG.md`, `coordination/CLOUD_AGENT_HANDOFF.md`, `coordination/POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md`, `docs/requirements/POCKET_AI_LAB_REQUIREMENTS_TRACEABILITY.md`, and evidence for the current exact Git heads. Cloudflare's revisioned private handoff is a contextual note, not a replacement for GitHub/CI evidence. Historical agent names do not imply active authenticated sessions.

The user requested cross-reference of Pocket AI Lab conversations, including those outside the folder. Past conversation retrieval is incomplete: earlier ChatGPT Project search reported memory-access restrictions. Never claim a private transcript was read, invent the remaining text, or create a plugin meant to bypass memory authorization. Carry forward only recovered, attributed summaries with source / timestamp / confidence / unresolved flags. A plugin can read owner-authorized exported summaries and revisioned handoffs. It cannot expand platform memory entitlements.

## End-state product
ONE native iPhone Air (256GB) / iPhone-first, offline-first, model-independent workspace. User supplies objectives, not required implementation steps. APEX/Director governs budgets, approvals, scope and protected actions; East/e3 preserves task identity, ordered events, checkpoints, cancellation and recovery; ExploitGym isolates evaluation; Critic and Validator independently challenge output; Evidence separates actual provider generation, runtime/device signing and server verification. An AI-owned task queue is separate from the user's personal tasks. Real local/hosted models are identified accurately. The website may not impersonate iOS runtime or fake a model response.

Permanent roles: Director, Reasoner, Researcher, Engineer, Security Analyst, Critic, Validator, Archivist, plus specialists. Modes: Collaborative, Security Analyst, Engineering, Learning, Independent Review. Integrate ChatGPT, Grok/Cursor, Codex, Cloudflare, optional Google/Factory and model providers only through real connected APIs with provenance, resource limits and independent review. Offline operation must not depend on cloud services.

The owner requires a full authorized offensive red-team / bug-bounty division, including ARTEX, STRIDE-GPT, ExploitGym, the historical six-layer / M01-M42 modules, business-logic/API/source/differential analysis, threat modeling, controlled replay, independent proof and human-reviewed reporting. Obtain current written target authorization/scope and honor exclusions; no real target execution, auto-submission or agent-created permissions without approval. Retain existing engines rather than replacing them with shallow imitations. Original complete M01-M42 descriptions/tier mappings remain unproven in currently recovered source.

Research directions: DeepSeek teacher/student distillation, held-out evidence retrieval, citations, offline small-model operation, G.I.R.L. geometric/latent exchange with real sender+receiver proof and text fallback, temporal intelligence distinguishing real versus simulated events, mind mapping, reversible learning, resource/thermal budgets, and comparable expert-human bug-bounty benchmarks. Hypotheses and draft work do not become qualified features without reproduced results.

## Earlier blocked/help requests; exact resolution
1. Dot/Kay persistent context: ChatGPT memory/project-folder restrictions cannot be overridden by Factory or custom plugin. Use owner-permitted source summaries, GitHub requirements registers, Cloudflare handoff revision checks, and explicit provenance. Never copy private chats without authorization.
2. Continuous agents: ChatGPT sessions cannot silently operate forever or wake other apps on their own. Factory background jobs or GitHub workflows can perform explicitly configured bounded tasks with a credentialed executor, stop conditions, quotas and visible status; no assertion a task is running without backend evidence.
3. Browser/phone-only development: repositories, CI and Factory cloud tasks are possible from Safari, but signing/installing/physically verifying the native app still requires appropriate Apple tooling, credentials, paired device and evidence.
4. Grok/Cursor/OpenClaw: historic mailbox/branches are not live reciprocal chat channels. Use recorded GitHub messages and scoped authenticated API integrations rather than promise private transcript access or automatic wakeup.
5. Security-engine skills: earlier private workflow plugin included limited Continuity and Device/Cloud workflows; rejected engineering/offensive skills are NOT installed via that plugin. Provide authorized local/isolated implementations and reviews rather than claiming to bypass skill/platform restrictions.
6. Cloud/Google/Factory limits: hosted resources, quotas, subscriptions and provider execution must be observed, not guessed. No keys in repo, prompts, GitHub logs, or chat.
7. Claims of closure: synthetic Docker, simulator/CI, vendor component, Llama/Metal crossbuild and research retrieval results must remain distinct from full engine integration, signed APEX authorization, physical-device inference, release or benchmark proof.

## Current engineering gaps and release gates
- East lifecycle modules still missing from main in recent general CI; stacked PR component proofs do not establish released integration.
- APEX trust/approval boundaries, PostgreSQL RLS v3.12 and breakglass/column-grant audit require exact-source review, tests and deploy evidence; no fabricated SQL function or implicit privilege.
- Signed generation evidence, anti-replay, session binding, recovery and independent artifact checks require whole-system proof.
- iPhone Air: signed physical install, true offline public-source generation, termination/restart recovery, SHA/digest preservation and independently verified export. Record iOS version, model file/hash, exact binary, measured temperature/memory/battery, failures and timing.
- Full 42-module provenance; security-engine source/license and bounded target-admission integration; held-out business-logic benchmark; real provider/account execution.
- Branch/PR reconciliation, CI at exact heads, final reviewed merges, rollback, production auth/secrets/deployment and observability.

## Factory integration architecture / safeguards
ChatGPT (coordination/research) -> private authenticated plugin [NOT YET DEPLOYED] -> server-side authenticated gateway [NOT YET DEPLOYED] -> Factory Droid Execute API -> separate `factory/*` repo branch and draft PR -> Critic/Validator + owner review -> standard merge authorization. Cloudflare revisioned handoff and GitHub coordination are the durable approved context. Factory cannot access Dot memory merely by being connected, authorize itself through APEX, alter the user's private tasks, or execute real-target offensive work without separate signed permission.

New isolated implementation: `integrations/factory-droid/client.mjs` and `client.test.mjs`. Vendor docs: https://docs.factory.com/api-reference/droid and https://docs.factory.com/droid-exec/execute-api . `POST /api/v0/droid/execute` requires Bearer API key, prompt and target; accepted 202 returns sessionId/computerId/messageId, NOT completed work. Poll `GET /api/v0/sessions/{sessionId}?computerId=...` and messages, proving an assistant message after the returned messageId AND session idle. Session APIs may require specific organization permissions. Factory plans/usage/credits must be checked and bounded before first live dispatch.

**Stages**
A. Synthetic dry-run and API schema verification; new files only; no provider calls.
B. Owner links Factory to GitHub using least-privilege OAuth/App permissions, provisions Factory environment and API key stored only in an authenticated secret store; set quotas and cancel/stop behavior.
C. Deploy auditable HTTPS gateway, HTTPS authentication and private ChatGPT plugin with read-only status plus explicitly owner-approved task execution; never expose bearer token to client.
D. Admit one Factory Droid by identity/environment/exact file claim on agent-coordination; ChatGPT confirms non-overlap before modifications. Run a small synthetic repository task, compare exact commits/tests/logs.
E. Require draft PR, independent review, provenance and resource evidence, then authorize merging separately. Expand to multiple Droids only after end-to-end proof.
F. Reconcile complete Pocket AI Lab requirements and close gates with reproducible proof, not statuses.

## Disposition
This handoff does not imply that the Factory account is linked, API key exists, an endpoint was deployed, a Dot memory plugin gained privileged data, Factory executed code, a PR passed CI, or full Pocket AI Lab is complete. Always distinguish proposed, prepared, tested, connected, and verified.

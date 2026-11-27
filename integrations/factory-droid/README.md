# Factory Droid — staged integration

This directory provides an isolated Factory API adapter, synthetic tests, and the full project [handoff](./HANDOFF.md). Nothing is deployed; no Factory key or account has been connected and no Droid task has been dispatched.

## What exists
- `client.mjs`: strict branch/task preparation, approval required before dispatch, Bearer API request utility, execute and session-reading endpoints.
- `client.test.mjs`: isolated network-mocked tests.
- `HANDOFF.md`: project vision, known restrictions, research gaps, prior work, safety controls and phased Factory adoption.

## Synthetic test
Run `node --test integrations/factory-droid/client.test.mjs` on Node 22+. Tests do not contact Factory and do not prove production connectivity.

## Factory API
Documentation: https://docs.factory.com/api-reference/droid and https://docs.factory.com/droid-exec/execute-api .

Execution is accepted with HTTP 202, returning `sessionId`, `computerId`, `messageId`. Completion requires both an idle session and an assistant reply after that user message. Some sessions API operations require organization entitlement. The current adapter provides basic read calls; **it does not yet implement polling/retry/turn completion verification, a server, or an installed ChatGPT plugin.**

## Required next actions
1. Owner links Factory to the GitHub repository and configures a least-privilege Factory Environment. Check plan/credits/usage before any paid run.
2. Obtain a Factory API key through Factory's settings. Store it only in a server-side secret store, never in GitHub, this chat or client Javascript.
3. Build/deploy a private authenticated gateway and expose only scoped read-status and approved-execute plugin tools.
4. Admit Factory as a separate, exact-file-scope agent through agent-coordination before it may change repository files.
5. Prove a synthetic session, exact PR, logs, source hashes and independent review before wider rollout.

No protected APEX/East/iOS runtime edits, merges, security target scans, production deployments or account-setting changes are authorized by this branch.

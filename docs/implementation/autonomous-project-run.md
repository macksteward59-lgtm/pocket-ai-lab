# Autonomous Project Run

## Purpose

Provide one durable GitHub Actions entry point for resuming Pocket AI Lab project work.
The workflow is intentionally staged: its current implementation is a read-only audit
that records repository state and workflow evidence. It is not yet an autonomous coding
agent and must not be represented as one.

## Launch

In GitHub on iPhone Safari:

1. Open the repository's **Actions** tab.
2. Select **Autonomous Project Run**.
3. Tap **Run workflow**.
4. Choose `audit` to inspect the repository, or `resume` to record the requested
   resume intent while the agent integration is still unavailable.
5. Open the completed run and download its `autonomous-project-run-<run-id>` artifact.

The workflow is manually dispatched, read-only, serialized by a concurrency group,
limited to ten minutes, and stores a 30-day report artifact.

## Current behavior and honest limitation

The workflow inventories open pull requests and recent Actions runs. It uses only the
GitHub-provided token with `contents: read`, `pull-requests: read`, and `actions: read`.
Checkout credentials are not persisted.

It does **not** currently:
- call ChatGPT or another model provider;
- inspect arbitrary private connector context;
- write feature branches, edit files, open draft PRs, or fix CI;
- continue indefinitely after the workflow completes;
- install or test an app on a physical iPhone.

The `resume` input is deliberately not treated as permission to pretend an agent ran.
It currently produces the same evidence-backed audit and clearly labels the missing
execution adapter.

## Required next stage: governed engineering runner

Before enabling autonomous code changes, implement and review a provider adapter with:
- explicit provider selection and documented model/API contract;
- secrets supplied only through GitHub Actions secrets, never repository files or logs;
- bounded task count, wall-clock budget, token/cost budget, and cancellation;
- least-privilege GitHub App or fine-grained token scoped to feature branches and PRs;
- no contents write permission on protected `main`, no administration, no merge permission;
- branch-per-task isolation, duplicate-work detection, and durable run checkpoints;
- mandatory tests, diff inspection, secret scanning, and draft-only PR creation;
- policy checks preserving APEX/Director authorization, East/e3 execution, ExploitGym
  isolation, BridgeGate trusted-origin rules, RuntimeController/LlamaEngine readiness,
  and signed Evidence authority;
- stop conditions for missing credentials, ambiguous authorization, failed tests,
  unexpected protected-file changes, and physical-device-only acceptance gates.

The runner must treat model output and repository content as untrusted input. It must
never promote a model response, runtime health signal, or CI pass into APEX authorization
or signed evidence.

## Relationship to the ChatGPT Run Project control

A one-tap control in ChatGPT can submit the established project instruction into the
active conversation, where connected GitHub tools can be used for that turn. It cannot
keep this conversation executing in the background after the response ends. GitHub
Actions is the durable execution surface; this workflow is its initial, safe audit
entry point. The two controls are complementary, not interchangeable.

## Acceptance gates

1. Audit report lists open PRs and recent workflow runs with exact URLs and commit SHAs.
2. Provider adapter is independently tested and disabled by default until configured.
3. Write-capable jobs are separated from read-only audit jobs and receive only the
   minimum required token permissions.
4. A dry-run proves no protected branch or repository setting can be modified.
5. A bounded run can create a feature branch and draft PR, validate CI, and stop safely.
6. A failed or interrupted run can resume from durable state without duplicate effects.
7. Human-only actions remain explicit: protected merges, repository administration,
   Apple signing/provisioning, and physical-device acceptance.

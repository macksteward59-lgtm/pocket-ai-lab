# Project acceptance as of November 22, 2026

The owner's [14 release gates](../../../../requirements/POCKET_AI_LAB_REQUIREMENTS_TRACEABILITY.md) cover both the on-device app and the services around it. Each row below distinguishes the evidence available to a reviewer from the observation that is still needed. The [branch inventory](project-inventory.json) gives the exact snapshot, branch ancestry and historical requirement counts. A branch outside the candidate may contain equivalent changes. These counts cannot establish a percentage complete.

| Gate | Evidence reviewed | Open condition |
| --- | --- | --- |
| 0. Baseline | Enumerated every open PR head in the snapshot and compared its parents with main and the review candidate. The candidate contains the measured source-answer and device-sampling branches and main. | One reviewed release candidate covering the rest of the intended modules. The original per-module layer and tier mapping remains incomplete. |
| 0.1. Trust contracts | Governance sidecar ran 46 tests. Native memory and independent review check source identity, edits, and externally retained digests. | System-wide evidence for every authorization boundary and production storage policy. |
| 1. Native offline inference | Hosted runner and Linux provider histories, simulator acceptance, device build records and resource tests are available. | Signed, paired iPhone Air running an imported model offline through load, generate, cancel and reopen, with recorded resource observations. |
| 2. Model registry and routing | Original 1.5B and independent 3B answers include different request IDs and model fingerprints. Unit tests cover the native document adapter. | Observe automatic and manual routing, fallback and honest unavailability for each advertised provider in one release. |
| 3. Agent team | OpenClaw has a recorded one-shot engineering review on an earlier revision. Two distinct server models answered one public question. | Observe the permanent roles and a temporary specialist executing one owner-directed benign task with identifiable providers. |
| 4. Deliberation | Two independent model replies to the same question are archived. An owner can compare the actual excerpts and retain a correction. | Demonstrate the full in-app, bounded reviewer exchange and disagreement on held-out benign tasks. |
| 5. Persistent memory | The native store records an immutable draft and source, owner edits, and a stable identity. The browser has restart coverage. The simulator/export result is recorded in the accompanying report. | Verify physical recovery and backup/restore across the four promised memory layers. |
| 6. APEX and East | The review flow leaves model proposals unverified. Existing governance and Worker persistence checks ran. | Show one authorized document-review task retaining its policy decision, owner, and checkpoint through an actual backend restart. |
| 7. Product UI | Both supported web engines exercise source search and memory recovery. Native coverage reaches the Memory and Local AI controls. | Complete the whole owner journey across all five modes with accessibility and actual handset interaction. |
| 8. Research and engineering | The two retained model outputs, specific citation and tested changes are attributable. The prior ordinary coding repair improved from 4/20 to 7/20 held-out cases. | Repeat on independent ordinary research and coding tasks with predefined quality targets. |
| 9. Security research | Existing artifacts describe scope restrictions and human review. This acceptance exercise used a public documentation question. | The evidence reviewed here establishes no competitive bug-bounty performance or whole-program security assurance. |
| 10. Time and resumption | Local records carry revision identity and timestamps. The note service has conditional writes and idempotent retries. | Interrupt a benign scheduled job and verify that it resumes from its saved checkpoint. |
| 11. Distributed compute | Linux inference, a separately implemented reader, GitHub CI and the private Cloudflare note connection each have attributable records. | Authenticate an actual Workers AI inference and observe measured free capacity, offline synchronization, and recovery through the same job. |
| 12. Release readiness | Project checks cover the browser, local server, native app builds and an unsigned test kit. Exact CI results and packet identities are in the accompanying report. | Signed physical-device acceptance, privacy and accessibility sign-off, backup and restore, and a reviewed release decision. |

Additional context is in the [owner's consolidated handoff](../../../../../coordination/POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md), [historical source recovery](../../../../../coordination/HISTORICAL_SECURITY_FRAMEWORK_SOURCE_RECOVERY.md), [earlier comparisons](../README.md), and [ordinary coding repair experiment](../../../../../coordination/evidence/tool-workshop-repair-2026-11-21/README.md).

## Two additional review branches

Two drafts appeared while this inventory was running. They both forked from an earlier revision of #262. I inspected the five affected files, applied them together to a disposable local checkout of the candidate, and ran both suites. All 18 offline-review tests and five source-answer tests passed together. The published candidate and the device kit identify their own contents by commit.

- [#263](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/263) reports completed generations separately from recorded attempts. Its specific [offline evaluation CI](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44993173915) and [repository CI](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44993170057) passed at `42d15e7`.
- [#264](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/264) rejects a blank explicit question before starting a model. [Repository CI](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44993147759) passed at `2e96430`.

## Trigger and write ownership

The reviewed candidate runs the repository checks on its feature push. The PR base and changed paths select the browser, offline Worker, Apple and source-answer checks. The optional OpenClaw workflow is specifically for PR #245 and skipped this PR. The private Cloudflare connection reads and conditionally replaces one named project note. The note's contents are data. In the checked implementation saving a note starts no new GitHub commit, CI workflow or model call. ChatGPT published each coordination update explicitly. No live Worker deployment was part of the acceptance run.

## What the branch checks cover

GitHub returned 141 open pull requests at the inventory cutoff, representing 136 distinct heads. The candidate contained 41 of those exact heads. For each head I queried pull-request-triggered Actions runs and retained the latest returned run per workflow. At the cutoff, 68 PRs had success with possible skips, 22 had a failed workflow, six had cancellation, two had only skips or neutral results, one was running, and 42 had no PR-triggered result in the response. Push-triggered checks can exist independently. A historic failure on an ancestor does not establish a defect on the candidate. Each failed job and step is indexed in the [workflow snapshot](pr-workflows.json). The final candidate runs are documented separately.

The historical requirements ledger contains 344 rows across 28 groups. Its recorded counts were 212 unassessed, 85 implemented but awaiting verification, 38 partial and nine blocked. Later tests close specific observations. They do not establish all criteria of a gate.

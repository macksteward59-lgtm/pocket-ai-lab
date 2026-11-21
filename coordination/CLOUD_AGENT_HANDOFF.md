# Pocket AI Lab shared project handoff

Use this page to resume the Cloudflare and ChatGPT project handoff from another chat. ChatGPT relays the owner's project decisions through its connected tools. The GitHub branch records the engineering history.

## Owner-approved project brief

Pocket AI Lab is meant to replace a fragmented cybersecurity research workflow with one iPhone-first environment for research, creation, evaluation, learning, and reporting. APEX and ExploitGym form its core. The owner gives an objective from an iPhone Air. The lab can create a provisional artifact before it fully understands the problem, test its assumptions, revise it, and return the result with supporting evidence. The owner can see progress, intervene, or inspect the details when needed.

Director/APEX selects work and enforces scope, permissions, and resource limits. East/e3 carries the same task identity through checkpoints, cancellation, and recovery. ExploitGym is the isolated evaluation environment. Critic and Validator examine the results independently. A candidate can be wrong, inconclusive, or worth keeping. The record preserves its source, model, assumptions, changes, and evidence.

One native workspace brings together the personal companion, AI Integrator & Automator, models, agents, tasks, approvals, and memory. The AI owns its work queue separately from the owner's personal to-do list. Collaborative, Security Analyst, Engineering, Learning, and Independent Review modes share the same contracts. Director, Reasoner, Researcher, Engineer, Security Analyst, Critic, Validator, and Archivist can bring in temporary specialists. Real model calls must identify the provider. Work starts locally and offline where feasible. Approved private or cloud compute can return versioned results within privacy, cost, and device limits.

Research with sources, software development and repair, threat modeling, and authorized red-team and bounty research share memory, knowledge, and evidence. The original security framework has six layers and 42 named modules. The competitive goal is to outperform experienced human bounty hunters, especially on business-logic flaws. Each program's current written scope, exclusions, and limits apply. Findings need independent validation and human review before submission. A proposed benchmark compares human and model reviews of the same held-out evidence with equal time, scoring confirmed findings, false positives, impact accuracy, and report quality.

The learning system should remember events, facts, relationships, and useful procedures with provenance. Users can correct, export, and delete memory. Temporal intelligence distinguishes real events from simulations. Mind mapping, multidimensional reasoning, and Minimal Surface ideas are research directions. G.I.R.L. (Geometric Intelligence Representation Layer) explores compact exchanges between compatible models with an ordinary-text fallback. Learned skills and changes to models or workflows require separate evaluation and a rollback path.

ChatGPT and GitHub coordinate development. Cloudflare stores this shared brief. The app's MessageBus carries runtime messages. The first complete proof is one real, authorized task on a physical iPhone Air with attributable model work, an independently checked artifact, and recovery after interruption. The handoff works today. Whole-product acceptance and competitive performance still require evidence.

First Cloudflare collaboration task, prepared for staging. Review the completed CI evidence for GitHub PR #245 at 66cedc4bec7c402dd30f13e2478d4dba8dc7aa07, workflow run 44925093206. Use the test-summary operation to draft what passed, what it proves, and what remains untested. ChatGPT checks the draft against GitHub and records the accepted result once per reviewed commit. Start with one manual staging run using separate state. The live notes service remains the project record in Cloudflare. For earlier decisions, ChatGPT retrieves the relevant available sources and adds a dated summary to the handoff.

## Full ecosystem and sources

The [complete product handoff](./POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md#2026-11-21--how-the-ecosystem-should-work-for-its-owner) maps this brief to the companion, agent team, APEX/East, ExploitGym, native and cloud compute, learning and memory, temporal reasoning, experimental communication, research scope, release gates, and open source-recovery questions. It includes an example of how a provisional artifact becomes a reviewed result. The November 21 project chat clarified that the owner should be able to give the objective without directing the steps.

## Basis for the competitive goal

On November 14, 2026 the owner identified experienced human bounty hunters as the comparison group and prioritized business-logic research. On November 21 the owner explicitly described this as offensive red-team research. The evaluation measures above are a proposal from the earlier discussion. Demonstrating a comparison requires a named baseline, matched cases and resources, and an independent score. The verified Cloudflare handoff establishes that the notes integration works.

Section 13 defines the bug bounty division. Gate 9 covers program policy, exact scope enforcement, independent validation, and human-reviewed reports. PAL-13-001 through PAL-13-015 are the corresponding traceability entries. [Master requirements, section 13](../docs/requirements/POCKET_AI_LAB_MASTER_REQUIREMENTS_CHECKLIST.md#13-bug-bounty-research-division) · [Requirements traceability](../docs/requirements/POCKET_AI_LAB_REQUIREMENTS_TRACEABILITY.md) · [Advanced security research requirements](../docs/requirements/ADVANCED_SECURITY_RESEARCH_REQUIREMENTS.md)

## Shared record

- Cloudflare handoff UUID `2d655f09-47c0-4f52-9b14-5398599e7667`
- ChatGPT plugin [Pocket AI Lab Cloud Agent](https://chatgpt.com/plugins/plugins_6b00b4d1f1208191bf94a0fedbdb2728)
- [Verified read/write implementation](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/245) at `66cedc4bec7c402dd30f13e2478d4dba8dc7aa07`
- [Cloudflare Worker integration test](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44925093206)
- [Complete project vision](./POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md) and [coordination log](./LOG.md)

## Delivery

Cloudflare preview version `4ef460aa-d55c-49b3-a025-d978b63800e0` is live. An authenticated client saved the original coordination brief and read back the same text at revision **1**. A separate synthetic note verified creation, update, immediate retry and stale-revision rejection. The live endpoint rejected anonymous access and denied writes using the status-only credential.

A fresh Work chat inside Pocket AI Lab attached the owner-private [Pocket AI Lab Handoff](https://chatgpt.com/plugins/plugin_asdk_app_sites_ae9fb2a80eac81918eae62f16f7cc1df) app and called `document_handoff_read`, `document_handoff_save`, and `document_handoff_read` on the shared UUID. Each call returned revision **1** and the same text. The save used the observed revision and identical text. Source revision `68342f6ccdfe72bc3cfa775d514fae23c8b6abf4` passed four local checks, including redirect handling. The app connects to the existing Worker using its protected note credential.

To resume, open a Work chat in this project, select **Pocket AI Lab Handoff** from the `@` menu, and ask it to read the shared project note. To record a decision, read the latest revision, save the revised text, then read it back and record the returned revision here. The existing daily workflow records which destinations it reached.

On November 21, ChatGPT saved the competitive research scope and read it back verbatim from Cloudflare at revision **2**. The subsequent ecosystem reconciliation was saved and read back at revision **3**.

Cloudflare revision **4** adds the first staged test-summary assignment. Its input is the [completed PR #245 workflow](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44925093206). The brief was read back from Cloudflare. The staged model review is pending.

When updating this handoff, read the latest branch and Cloudflare note, retain unresolved decisions, and record the observed note revision. Include the verified change in the active conversation and append its evidence to the coordination log. Future readers should distinguish the author of each note from the service that stored it.

The staged CI review input for PR #245 is available in Pocket AI Lab Handoff under note UUID `fbeaf347-16ee-5111-923f-e5812e8938c6`, revision 1. It identifies the GitHub job, its assertions, and ChatGPT's independent test results. A separate Workers AI response is pending. Read this note by UUID when resuming the review.

OpenClaw's first development assignment was a local-model review of the staged PR #245 CI record. ChatGPT checked its draft, saved the result as note `63da18fc-8722-54ac-9a0c-6db834487c20` at revision 1, and read back the same text. Revision 5 of the shared project note links that result. [PR #246](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/246) holds the reproducible one-shot setup. OpenClaw runs on the local or GitHub CPU. Cloudflare stores the shared note. Its Workers AI inference trial still requires scoped access and a verified free account allowance.

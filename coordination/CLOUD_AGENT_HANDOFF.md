# Pocket AI Lab shared project handoff

Use this page to resume the Cloudflare and ChatGPT project handoff from another chat. ChatGPT relays the owner's project decisions through its connected tools. The GitHub branch records the engineering history.

## Owner-approved project brief

Pocket AI Lab is a local-first iPhone research workspace with model-backed roles, durable memory, and independent APEX and East/e3 controls. Its bug bounty division supports authorized offensive red-team research. The owner's goal is to outperform experienced human bounty hunters, especially on business-logic flaws where software permits an outcome its own rules forbid.

The research scope comes from each program's versioned policy, which specifies eligible assets, exclusions, permitted methods, time windows, and limits. Ambiguous scope goes to human review. APEX governs authorization independently of East/e3 execution. A finding needs independent validation, evidence of impact, and human review before submission.

ExploitGym is the isolated evaluation setting for the prototype. The current harness milestone uses inert fixtures and precomputed results. A proposed comparison would give human and model reviewers the same held-out case evidence and time budget, then score confirmed findings, false positives, impact accuracy, and report quality independently. Superior performance is a goal awaiting comparative evidence.

ChatGPT coordinates work from available project decisions. GitHub's agent-coordination branch records scope, ownership, code references, and test evidence. Cloudflare stores the revisioned shared note for project chats. Verify each milestone against its source, test, and runtime. The interactive handoff has passed its read, save, and read-back check.

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

On November 21, ChatGPT saved the revised shared brief above and read it back verbatim from Cloudflare at revision **2**.

When updating this handoff, read the latest branch and Cloudflare note, retain unresolved decisions, and record the observed note revision. Include the verified change in the active conversation and append its evidence to the coordination log. Future readers should distinguish the author of each note from the service that stored it.

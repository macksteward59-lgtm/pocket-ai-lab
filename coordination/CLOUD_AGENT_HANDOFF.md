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


## Integrated owner review prototype

[PR #249](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/249) assembles the native client, local OpenClaw runner, consumer Activity and Memory screens, and Cloudflare document Worker in one checkout. The private Pocket AI Lab Handoff app points to the existing live preview. The project brief is at revision 6 and links the engineering evidence note `0460d1e6-678f-5533-ab19-826a121d584d`.

The owner can open Activity to compare the fixed CI draft with its GitHub source. The app prepares a handoff from the recorded outcome and counts even if the model omits them. In the native app, **Self-evaluation history** can export one attempt with its prompt and output. Activity checks the bytes against the event digest copied separately from that history. The owner can inspect the result, edit a note, and retain it through Memory.

GitHub runs acceptance checks on code changes. The tests exercise a pinned local model, the native Swift exporter, an independent Python reader, two browsers, and the local note Worker. The private ChatGPT connection relays reviewed project notes to Cloudflare using the revision returned by a read. A note save starts no build, deployment, or model job. The existing project automation records routine work in coordination and reserves its owner notification for verified prototype acceptance.

The [combined acceptance run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44941583527) passed on commit `bf3c9e6b`. ChatGPT then matched the published bytes against the source and saved them through the live private connection. Read note `6533b3e4-84e1-5e21-a78b-31495d668c30` at revision **1** for the resulting handoff. An identical retry returned revision 1, and the next read returned the same text. Its SHA-256 is `b2b7b357030c74298ad1f94b28cc19a27aeb3d8e6671553eee1b6bd5af96a378`.

The engineering note is confirmed at revision **2**. The [native validation run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44939549749) built the app and passed its simulator app tests. Its frozen A/B model benchmark returned 32 outputs outside the required format and four empty responses across 36 requests. This is a reproducible negative result for that benchmark. A signed physical iPhone Air run and an authenticated model response from Workers AI remain open.

## Project research memory

[Research memory and experiment results](../docs/research/project-research-memory.md) · [Versioned source register](../docs/research/project-sources.json). The private research note is `6f6b446a-c306-5610-9fab-fa8c5777b881`, revision 2. The engineering note links to it at revision 4. A later chat can read the eight findings and original URLs through the existing Handoff app. The November 21 source-backed Qwen run answered and cited two of six supported questions and abstained on all six withheld questions. All twelve records repeated byte for byte on a second host. These observations concern short supplied documentation passages on Linux.

## Foundation for experiments

The owner wants experimental models and donor components to serve one dependable iPhone workflow. Judge the foundation through one owner-visible task: establish its identity and allowed scope, preserve its input and sources, identify the provider that actually ran, recover the acknowledged result after interruption, and let an independent reviewer check the artifact. Retain the earlier result and its limitations when comparing a new candidate. Keep this path accessible through the ordinary app controls.

A concrete recovery check lives in [draft #253](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/253). The original Memory API dropped both references on a content-only edit; the previous browser editor joined multiple citations into one field. The revised path preserves separate source values, ID and creation time and resets verification after an edit. This protection applies to existing records whose source arrays still contain separate values. A flattened historical string cannot be reliably split just by looking for commas. Physical-device acceptance still requires a real run on the iPhone Air.

### iPhone Memory recovery and independent answer checks

[Draft PR #254](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/254) extends #253 to the native iPhone Memory editor. Source fields preserve punctuation. The new native evaluation suite version scores the generated answer literally. The offline reader accepts a separately recorded event digest, prompt and expected output. ChatGPT saved the test evidence in Cloudflare note `95ac3529-1963-5039-b1a9-1627a2c46695`. The engineering handoff points to it at revision 6. Keep simulator recovery, a physical iPhone Air model run, and independent answer validation as separate results.

# Pocket AI Lab shared project handoff

Use this page to resume the Cloudflare and ChatGPT project handoff from another chat. ChatGPT relays the owner's project decisions through its connected tools. The GitHub branch records the engineering history.

## Owner-approved project brief

Pocket AI Lab project handoff. ChatGPT coordinates repository development from the project decisions it can access. GitHub is the record for code, test evidence and ownership. The Cloudflare preview stores shared handoff notes. The prototype is local-first on iPhone, with model-backed roles, durable memory, and independent APEX/East controls. Evaluate the harness interface with inert fixtures and precomputed benchmark results. Verify each milestone against its source, test and runtime. Next integration check: a fresh ChatGPT project chat reads this note and saves a reviewed update, then records the verified revision on agent-coordination.

## Shared record

- Cloudflare handoff UUID `2d655f09-47c0-4f52-9b14-5398599e7667`
- ChatGPT plugin [Pocket AI Lab Cloud Agent](https://chatgpt.com/plugins/plugins_6b00b4d1f1208191bf94a0fedbdb2728)
- [Verified read/write implementation](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/245) at `66cedc4bec7c402dd30f13e2478d4dba8dc7aa07`
- [Cloudflare Worker integration test](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44925093206)
- [Complete project vision](./POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md) and [coordination log](./LOG.md)

## Delivery

Cloudflare preview version `4ef460aa-d55c-49b3-a025-d978b63800e0` is live. An authenticated client saved the owner-approved brief above and read back the same text at revision **1**. A separate synthetic note verified creation, update, immediate retry and stale-revision rejection. The live endpoint rejected anonymous access and denied writes using the status-only credential.

A fresh Work chat inside Pocket AI Lab attached the owner-private [Pocket AI Lab Handoff](https://chatgpt.com/plugins/plugin_asdk_app_sites_ae9fb2a80eac81918eae62f16f7cc1df) app and called `document_handoff_read`, `document_handoff_save`, and `document_handoff_read` on the shared UUID. Each call returned revision **1** and the same text. The save used the observed revision and identical text. Source revision `68342f6ccdfe72bc3cfa775d514fae23c8b6abf4` passed four local checks, including redirect handling. The app connects to the existing Worker using its protected note credential.

To resume, open a Work chat in this project, select **Pocket AI Lab Handoff** from the `@` menu, and ask it to read the shared project note. To record a decision, read the latest revision, save the revised text, then read it back and record the returned revision here. The existing daily workflow records which destinations it reached.

When updating this handoff, read the latest branch and Cloudflare note, retain unresolved decisions, and record the observed note revision. Include the verified change in the active conversation and append its evidence to the coordination log. Future readers should distinguish the author of each note from the service that stored it.

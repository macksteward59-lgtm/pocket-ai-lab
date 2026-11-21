# Cloudflare preparation for Pocket AI Lab

## Current implementation

Reuse the existing repository, `macksteward59-lgtm/pocket-ai-lab`. The scoped follow-on branch is `codex/cloudflare-analysis-foundation-20261121`, based on Google foundation PR #238. Inspect the current source and its exact-head validation before use. The runbook is `docs/implementation/cloudflare-analysis.md`.

The implementation provides `CloudflareAnalysisProvider`, a pure destination-bound preview and an offline CLI. It does not provide a deployed Worker, native Cloudflare consent integration, durable dispatch host or Cloudflare submit command. Do not present the branch or a saved plugin release as an operating service.

The initial model is `@cf/openai/gpt-oss-120b` through the official account-bound Workers AI Chat Completions endpoint. It requests low reasoning. Reasoning is mandatory; the requested token cap is not verified billing or a known final-text/reasoning split. Cloudflare processing is provider-managed; this route does not retain Vertex's explicit-region guarantee.

For the user's newer DeepSeek interest, consult the runbook's model-selection section and current primary provider documentation. The initial allowlist does not yet admit DeepSeek. Its listed V4.1 Flash 1017 model requires paid access, and enabling it needs a separately reviewed model profile and billing policy. Do not relabel GPT-OSS output as DeepSeek, use a retired model, or turn the selected-text analysis workflow into an unreviewed training-data submission. Teacher-generated examples and actual student training are distinct work.

## Prepare a preview

Use an available authorized executor with Node 22, installed repository dependencies and the reviewed source. The iPhone can remain the user's interface; these commands run in the executor, not in mobile Safari. If no executor/source is available, prepare the selected text and report execution as unavailable.

Use exactly `task_id`, `purpose` and `selected_text` as input JSON. Purposes are `documentation`, `test-summary` and `design-review`. Selection is limited to 4,000 UTF-8 bytes.

Configure verified non-secret values:

- `POCKET_CLOUDFLARE_ACCOUNT_ID`: the actual 32-character account ID, not a GitHub username or Google project number.
- `POCKET_CLOUDFLARE_MODEL`: the explicit allowlisted model.
- `POCKET_CLOUD_AGENT_RELEASE_ID`, `POCKET_CLOUD_AGENT_COMMIT_SHA` and `POCKET_CLOUD_AGENT_ARTIFACT_SHA256`: the real reviewed component release and measured artifact.
- Optional `POCKET_CLOUD_AGENT_ATTEMPT_ID`: the task owner's attempt UUID.
- Optional `POCKET_CLOUDFLARE_MAX_OUTPUT_TOKENS`: 1–512, default 512.

Do not invent account or release provenance. Synthetic values belong only to declared fixtures. The CLI does not need or read a Cloudflare token:

```sh
node --import tsx scripts/cloudflare/preview.mts < selected-text.json
```

Review the complete emitted preview. It binds the account, model, endpoint, exact body, requested cap, reasoning disclosure, release, task/attempt, input hash and short expiry. It cannot submit the request. Expired or changed previews require fresh preparation and review.

## Finish hosting separately

Verify account access and the Workers Free plan before any live call; selecting a free-eligible model does not prove the account cannot incur overage. Keep payment upgrades and prepaid gateways out of this setup unless separately authorized.

Connecting GitHub to Cloudflare requires the repository integration in addition to account login. This branch has no Wrangler entrypoint. Complete and review the host's authenticated admission, independent task/release/preview approval checks, durable atomic one-use dispatch, budget policy and native provider disclosure before deployment or inference. Reuse the existing lifecycle coordinator; do not clone the Google worker.

Keep tokens in the authorized host's secret storage, outside chat, repository, plugin files and previews. Use secure authentication prompts for account login. A browser login does not supply runtime credentials.

Validate a future live response as candidate evidence without overwriting local results or promoting model readiness. Report any missing provenance/usage as unknown; never manufacture zeros or immutable model versions.

# Cloudflare selected-text analysis preparation

## Status and reuse

This is an additive provider and offline-preview foundation on PR #238. It is not a deployed Cloudflare service or an enabled native iOS route. The existing Google provider/worker and native DeepSeek gateway remain intact.

The new provider implements the existing `InferenceProvider` interface. Common selected-text purpose instructions, release validation, bounded plain-JSON cloning, canonical serialization and the local stdin reader are extracted once for reuse. Three complete Google previews were frozen from published source `6860ca4a6b3b9450cfe3cc409b98c10715e289a8` before extraction; compatibility tests require the exact serialized bytes and digests to remain unchanged. There is no second lifecycle worker, store, orchestrator or gateway.

The Cloudflare profile uses logical agent `pocket-cloud-analyst` and component `cloud-text-analysis`, with no permissions. These identify engineering and prospective operation of this component; they do not grant credentials or action authority. Existing Google IDs and evidence are not relabeled.

## Provider contract

The fixed provider is `cloudflare-workers-ai`. Its initial model allowlist contains only `@cf/openai/gpt-oss-120b`. A separate exact model profile admits the namespaced model without broadening task or attempt identifiers.

The request goes to:

```text
https://api.cloudflare.com/client/v4/accounts/{accountID}/ai/v1/chat/completions
```

`accountID` must be exactly 32 lowercase hexadecimal characters. Arbitrary base URLs, query strings, redirects, API gateways and fallback models are not accepted. The selected-text body consists of the configured model, the shared purpose instruction, the exact selected user text, `stream: false`, `max_tokens` and `reasoning_effort: low`. Task/attempt IDs, release metadata, credentials and private history are not sent to the model.

The preview binds the account, model, endpoint, exact request body, requested generation cap, reasoning policy, task/attempt, release provenance, input hash and short consent expiry. A digest detects changes; it is not an approval or signature. Google and Cloudflare previews are distinct and cannot substitute for each other's consent.

GPT-OSS reasoning cannot be disabled. `max_tokens` is a requested generation cap, not a verified allocation of final-answer versus reasoning tokens or a guaranteed bill. Current Cloudflare sources do not establish that breakdown for this route. The full provider response remains byte-bounded, and only the final assistant text is returned. Recognized reasoning fields are discarded. Incomplete, tool-bearing, refused, malformed and oversized output is rejected without retry or silently raising the cap. Missing provider response IDs, model identities or usage fields remain missing rather than being invented; any reported model remains provider-reported, not an attested immutable model artifact.

Transport construction requires explicit enablement and a host credential callback. Generate-time admission requires expiry and host authorization checks. Rechecks after asynchronous token/authorization work prevent late dispatch after cancellation or expiry. This is a transport admission boundary; the future host must independently verify the exact preview, authorized task, approved release and durable one-use dispatch claim. A callback returning true does not supply those verifiers by itself.

## Model selection and the smaller-model training goal

The initial allowlist deliberately contains only GPT-OSS 120B. As verified against provider documentation on 2026-11-20, Cloudflare also lists `@cf/deepseek-ai/deepseek-v4.1-flash-1017`, matching the newest DeepSeek release found in its official release notes. That model requires Workers Paid or prepaid AI Gateway credits. It is not enabled by this branch, and a GitHub sign-in does not unlock paid model access. Cloudflare's announced 2026-11-20 deprecations include its older DeepSeek R1 distilled model and V4 Pro/Flash entries; do not substitute those catalog names.

DeepSeek V4.1 Flash 1017 is a candidate teacher for a later controlled comparison, not an established Pocket AI Lab quality winner. Keep GPT-OSS as the free-access baseline while account access is completed. Before adding DeepSeek, define and test its explicit request profile, token/reasoning policy, response handling, billing admission and provider disclosure. Its documented token parameters and reasoning options differ from GPT-OSS; widening this allowlist alone is not sufficient.

Workers AI supplies inference, not customer GPU training. A teacher workflow would generate candidate examples, validate them against independent checks, train a smaller student in a separate supported environment, then compare the student on held-out project tasks and the target device. The current documentation/test-summary/design-review bridge neither exports a training dataset nor updates model weights. Do not treat infrastructure fixture passes, vendor benchmarks, a small historical LoRA demo, or invalid native benchmark runs as proof of distillation success. Preserve frozen evaluations and separate training data from held-out tests.

## Offline preview

Run from the checked-out repository in an executor with Node 22 and installed project dependencies. No Cloudflare token, login, network access or cloud resource is needed to construct a preview.

Required configuration:

| Variable | Meaning |
| --- | --- |
| `POCKET_CLOUDFLARE_ACCOUNT_ID` | Verified Cloudflare account ID; never a Google project number or GitHub username |
| `POCKET_CLOUDFLARE_MODEL` | Explicit allowlisted Workers AI model |
| `POCKET_CLOUD_AGENT_RELEASE_ID` | Host's actual component release identifier |
| `POCKET_CLOUD_AGENT_COMMIT_SHA` | Actual 40-character source commit SHA |
| `POCKET_CLOUD_AGENT_ARTIFACT_SHA256` | Actual 64-character artifact SHA-256 |
| `POCKET_CLOUDFLARE_MAX_OUTPUT_TOKENS` | Optional requested cap, 1–512; default 512 |
| `POCKET_CLOUD_AGENT_ATTEMPT_ID` | Optional existing attempt UUID; otherwise a new preview UUID |

Do not fabricate account or release values for real work. Synthetic fixture values are only for tests. Provide JSON on stdin containing exactly `task_id`, `purpose` and `selected_text`; supported purposes are `documentation`, `test-summary` and `design-review`.

```sh
node --import tsx scripts/cloudflare/preview.mts < selected-text.json
```

The CLI prints the exact preview and has no submit or deploy command. Selection is capped at 4,000 UTF-8 bytes, serialized input at 32 KiB, final text at 8,000 bytes and the complete provider response at 128 KiB. Consent lasts at most five minutes. Preview expiry requires preparation and review of a fresh preview.

## Account and hosting handoff

Signing in to Cloudflare with GitHub is account authentication. Installing/authorizing the Cloudflare GitHub integration, selecting this repository and branch, preparing a deployable Worker, configuring secrets/bindings, and testing its endpoint are separate operations. This branch has no Wrangler entrypoint and must not be treated as a deployable Worker simply because it is connected to GitHub.

Before the first real call, verify the selected account is on Workers Free and inspect its remaining account-wide allowance. Cloudflare currently includes 10,000 neurons/day on Free; some models require payment, and a Workers Paid account can incur overage even when the model also has free-plan eligibility. The adapter does not verify the account plan or remaining quota. No paid upgrade, prepaid gateway credits or fallback is configured by this code.

The operational host still needs: authenticated request admission, provider-bound native consent, an independent release/task/approval verifier, durable atomic dispatch reservation before network activity, restart/replay handling, cancellation/reconciliation and a measured budget policy. Reuse `TaskLifecycleCoordinator` and generalize the existing Google worker deliberately; do not clone it. A Cloudflare Durable Object or database must prove the existing atomic storage semantics before it replaces an injected lifecycle store. The current process-local replay set is insufficient across isolates/restarts.

Native `CloudAnalysisClient.swift` and its gateway still enforce DeepSeek attribution and disallow namespaced model IDs. A coordinated provider-disclosure/protocol change is required before the app can accept Cloudflare output. Keep local results, local models, memory, APEX/East, ExploitGym and frozen model-quality gates unchanged.

## Verification and limits

Focused CI typechecks the project and both preview entrypoints, tests Cloudflare request/parser/cancellation boundaries with injected fixtures, verifies the frozen Google previews and reruns existing Google worker/gateway regressions. Fixtures establish transport behavior only. They do not establish model quality, actual account access, billing, regional processing, a hosted agent or physical iPhone acceptance.

## Primary references

- [Cloudflare Chat Completions endpoint](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)
- [GPT-OSS 120B model contract](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/)
- [Cloudflare AI SDK reasoning configuration](https://developers.cloudflare.com/agents/models/ai-sdk/)
- [Official SDK response extraction](https://github.com/cloudflare/ai/blob/34a8f4c00c0871883215a7114e9a7f3e7747ee1b/packages/workers-ai-provider/src/workersai-chat-language-model.ts)
- [Official SDK usage mapping](https://github.com/cloudflare/ai/blob/34a8f4c00c0871883215a7114e9a7f3e7747ee1b/packages/workers-ai-provider/src/map-workersai-usage.ts)
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [DeepSeek V4.1 Flash 1017 on Cloudflare](https://developers.cloudflare.com/workers-ai/models/deepseek-v4.1-flash-1017/)
- [DeepSeek release announcement](https://api-docs.deepseek.com/news/news261017/)
- [Cloudflare model deprecations effective 2026-11-20](https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/)
- [Workers AI inference and responsible use](https://www.cloudflare.com/trust-hub/responsible-ai/)
- [Cloudflare GitHub connection](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)
- [Durable Objects Free-plan availability and limits](https://developers.cloudflare.com/durable-objects/platform/pricing/)

# Native supplemental cloud analysis

## Scope

This change implements the first bounded slice of the [hybrid architecture proposal](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/557120f3b8f0b3f0be23b7cb5a045d09ec468817/docs/architecture/Hybrid-Cloud-Offline-Synchronization-Proposal-20261120.md): explicitly request a cloud assessment of selected text and attach the result to an existing terminal Agent Team task.

The native local runtime, resident model, sequential agent plan, original role results and local final response remain intact. Cloud inference uses a separate provider boundary. A remote model never masquerades as a loaded local LlamaEngine session. This supplemental assessment does not replace a collective Agent Team run.

The gateway is off until explicitly configured. This source change does not deploy infrastructure, provision credentials, make a paid inference request, qualify a DeepSeek model, or establish physical iPhone readiness.

## Native flow

1. Open a completed, failed or interrupted task under **Recent Agent Team tasks**, then select **Request cloud analysis**.
2. Enter the configured HTTPS gateway origin, profile, DeepSeek model and gateway application access token. The token remains in memory for the sheet/request; it is not a DeepSeek API key and is not stored in history.
3. Review/edit the exact text to send. The initial selection is only the task objective. Role results, conversation history, private memories, attachments and model files are not automatically included.
4. Enable the one-request consent control and send. Editing any connection, credential, model, profile or text field resets consent. Submission captures immutable values and consumes consent before creating the asynchronous task.
5. Save a submitting attempt in the existing history archive before network dispatch. The cloud result is attached separately, with its task/attempt/input/model attribution and token usage. It remains unverified and grants no action authority.

The first slice serializes this request with other LocalChatModel operations. It does not introduce automatic model selection, background job continuation, retries, fallback, memory retrieval, cross-device sync or an execution queue. A new explicit attempt after an unknown outcome can incur another provider charge; the application never creates one automatically.

## Data and resource contract

The fixed endpoint is `POST /v1/cloud-analysis`. Only these request fields are accepted:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Exactly 1. |
| `taskID` | Existing bounded task identity. |
| `attemptID` | UUID; native requests use canonical lowercase. Gateway replay keys canonicalize case. |
| `profileID`, `requestedModel` | Must exactly match the configured gateway profile/model before inference. They cannot select an arbitrary upstream. |
| `inputText`, `inputSHA256` | Exact selected UTF-8 text and its SHA-256. |
| `consentExpiresAt`, `remoteConsent` | Integer Unix milliseconds, at most five minutes ahead, and literal true. |
| `maxOutputTokens` | Integer from 1 to 512; native UI uses 512. |

Input text is limited to 4,000 UTF-8 bytes, request JSON to 32 KiB, returned analysis text to 8,000 bytes, gateway response to 64 KiB and upstream response to 128 KiB. UTF-8 hashes do not normalize or trim the approved text. The provider receives exactly one user message containing that text; task identifiers and the gateway credential are not forwarded in the provider message.

The result echoes task, attempt, profile, model and input digest; records `execution: cloud`, provider-reported model and response ID, finish reason and usage; and requires `authorized: false`. The native client independently validates these fields even when a custom client is injected by the app host. Model identity is reported attribution, not signed runtime attestation.

## Gateway and provider

`packages/intelligence/serverless/cloud-analysis/` adds a bounded native-specific handler and a `DeepSeekAnalysisProvider` implementing the existing `InferenceProvider` interface. It does not change the general orchestrator contract or compose a second agent engine.

The handler builds a fresh inference request with the selected prompt, configured model, fixed analysis stage and empty context. It does not use the generic `/v1/generate` transport, which can serialize a wider inference context. Existing draft web cloud-chat PR #152 is preserved and remains a separate route.

The DeepSeek provider uses the fixed official `https://api.deepseek.com/chat/completions` endpoint. Requests use `stream: false`, `reasoning_effort: none`, an explicit output-token cap and `tool_choice: none`; no tools are provided. This is a bounded non-thinking integration profile. Its results must not be described as evidence for a maximum-effort reasoning configuration.

Provider responses must contain one usable assistant completion, a `stop` finish reason, permitted model identity and valid usage totals. Truncated output, tool calls, malformed responses and oversized bodies fail. The gateway never returns raw upstream error bodies or logs prompts/credentials. Application authentication and the server-held provider key are separate.

Current API references: [DeepSeek chat-completion contract](https://api-docs.deepseek.com/api/create-chat-completion/) and [models and modes](https://api-docs.deepseek.com/quick_start/pricing/), checked 2026-11-20. Actual service access, returned model naming and model quality still require an explicitly configured provider run.

### Operator reference host

The reference server is an explicit entrypoint; importing product modules does not start it. Required environment configuration:

| Variable | Purpose |
| --- | --- |
| `POCKET_CLOUD_ANALYSIS_ENABLED` | Must be `true`. |
| `POCKET_CLOUD_ANALYSIS_APP_TOKEN` | Gateway application credential, distinct from provider secret. |
| `DEEPSEEK_API_KEY` | Provider credential kept on the server. |
| `POCKET_CLOUD_ANALYSIS_MODEL` | Explicit supported model alias. |
| `POCKET_CLOUD_ANALYSIS_PROFILE` | Profile identity that the native request must match. |
| `POCKET_CLOUD_ANALYSIS_PORT` | Optional local listener port, default 8787. |

After configuring those values through the host's secret/configuration mechanism, the entrypoint is:

```sh
node --import tsx scripts/cloud-analysis/server.mts
```

It binds `127.0.0.1` only. A reviewed authenticated HTTPS deployment in front of it is required for a remote iPhone. The application client rejects HTTP origins; a test-only injected option permits loopback HTTP for fixtures. No production tenant/session provisioning, deployment, TLS termination or spending allowance is supplied by this reference host. Its application bearer credential is a scoped prototype access boundary, not completed multi-user authentication or APEX authorization.

## Failure and persistence semantics

The native transport uses an ephemeral URLSession, disables cookies/cache/credential storage, refuses redirects, bounds received bytes incrementally and has a 45-second timeout. The gateway also bounds request handling and upstream waiting. There is no application retry.

Consent expiry is an admission/disclosure deadline checked before dispatch. It is not a promise that an already-started provider computation terminates at that timestamp.

Errors distinguish `not_started` pre-dispatch rejections from `unknown` remote outcomes. A timeout, disconnection, malformed/mismatched response or cancelled wait after dispatch does not prove that the provider stopped processing or billing. The UI's **Stop waiting** action preserves that distinction.

The gateway permits one active local request by default. That cap does not prove that an earlier timed-out remote operation has stopped. Consumed attempt IDs remain in a bounded set for the process lifetime; duplicate attempts return an unknown-outcome error, and capacity exhaustion refuses new work. Restarting or replicating the reference host loses/partitions this set. It is not durable idempotency, a billing cap, result retrieval or exactly-once execution.

Cloud attempt records are optional additions to the existing v1 history schema. Legacy records remain readable. At most four cloud attempts are retained per task within the existing 50-task, 512 KiB and 30-day archive policies. The gateway access token is never encoded in an attempt. This history uses the existing local file protection; it is not the separate AES-GCM memory vault and is not signed evidence.

Cloud writes protect their target task from archive eviction. If JSON-escaped text makes that task alone exceed the archive cap, the write fails before replacing the existing file. The same protection applies when startup recovery changes pending cloud attempts to unknown. A non-recovering snapshot method refreshes live UI state without marking an active request interrupted.

A valid cloud response followed by a failed local save is reported as a persistence failure, not durable completion. A late response cannot recreate a deleted task or overwrite a different attempt. Original local team status, role outputs and final response are preserved.

## Verification

`Native Cloud Analysis` CI runs the focused TypeScript gateway/provider suite, compiles the actual Swift client and exercises it with both URLSession fault fixtures and a real loopback HTTP request through the production gateway. The gateway's upstream model response is explicitly injected in that test; no external model is invoked.

The same workflow copies the actual client/history sources and existing/new history XCTest files into a temporary Swift package. This verifies legacy decoding, persistence, unknown recovery, duplicate/mismatch rejection, archive eviction and JSON-capacity failure behavior without a model download. It does not substitute a storage reimplementation.

The existing native workflow gains only the stacked PR base trigger so it can build/test the full application and app-level cloud composition. Its original frozen recipient benchmark, prompts, parser and gates remain unchanged. A successful cloud transport fixture does not change the earlier 0/36 strict-format outcome.

Local commands:

```sh
npm run build
npx vitest run packages/intelligence/serverless/cloud-analysis/cloudAnalysis.test.ts
```

Hosted macOS additionally runs the standalone client harness and history XCTest. Full app XCTest covers no dispatch on invalid consent/missing task/storage failure, persistence before sending, response revalidation, result separation and unknown versus rejected outcomes. Exact-source results are recorded in the coordination log and linked workflow runs; these instructions alone are not a test-pass claim.

## Remaining integration boundaries

Automatic routing, durable outbox/dispatch/result retrieval, server restart recovery, tenant isolation, production APEX authority, selected-memory/context synchronization, provider readiness and measured model quality remain separate work. The older TypeScript llama adapter's configurable non-loopback destination also remains a distinct disclosure-policy gap; this new native path does not claim universal consent enforcement across the product.

ExploitGym, local inference, local evaluation failures and GIE alignment work are preserved. Any future cloud or hybrid benchmark result must identify its exact configuration and execution locations independently of local-only results.

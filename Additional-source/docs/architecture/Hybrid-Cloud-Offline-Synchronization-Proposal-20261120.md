# Pocket AI Lab: optional cloud compute and offline synchronization

Date: 2026-11-20

Status: **proposal / in-review**. This is a documentation handoff extending the existing offline-first requirements. It does not enable a provider, deploy infrastructure, establish a spending allowance, or change an acceptance gate.

## Recommendation

Keep Pocket AI Lab as one model-independent harness with a useful native local tier and an optional cloud tier. Use a larger cloud model when a task warrants its capabilities and the selected data, cost, and execution scope are authorized. Keep the local model available for eligible offline work. The larger model stays on its remote service; ordinary offloading exchanges task input and results, not model weights.

Preserve the existing local runtime, collective agent structure, Director/APEX boundaries, East task lifecycle, encrypted native vault, model registry, and ExploitGym integration plan. Extend the existing provider interfaces rather than introducing a competing orchestrator. Existing implementation and evaluation gaps remain tracked independently.

Synchronize versioned application records: task history, approved context, checkpoints, results, selected memory entries, and necessary artifact bytes. The harness provides continuity across models. It does not make a small model acquire the cloud model's reasoning ability merely by copying a conversation or report.

This direction matches sections 0, 3, 6, 9, 15, 21 and 28 of the [master requirements](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/e80dc1903a289c068443cb55f4ef233e5fab239c/docs/requirements/POCKET_AI_LAB_MASTER_REQUIREMENTS_CHECKLIST.md). Google Cloud is an existing hosting candidate, not a selected or provisioned dependency. No monetary budget is assumed.

## 1. What exists and what still needs integration

The audited sources are main `fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873`, the native PR #234 stack `6a61281a1d28a6b8ee1a292c74f8515c2250d110`, draft web cloud-chat PR #152 `2d15997ad4238c0a88ce2e42223c062c711f109f`, and coordination `e80dc1903a289c068443cb55f4ef233e5fab239c`. Native-stack and draft-PR capabilities must not be described as merged main behavior.

| Component | Source-observed foundation | Remaining integration boundary |
| --- | --- | --- |
| Remote inference | Main has an explicitly enabled `RemoteInferenceProvider`, finite request timeout, optional bearer token and custom `POST /v1/generate`. | Not composed into the consumer app or native runtime. It sends the entire `InferenceRequest`; it is not a DeepSeek `/chat/completions` adapter or a selected-context disclosure policy. |
| Native local execution | The audited native stack composes one resident model and one concurrent request, with logical agents scheduled sequentially. | No cloud provider or native cloud-consent route was found in that stack. Resource and physical-device acceptance remain separate. |
| Cloud chat | Draft PR #152 has an unchecked, single-message cloud consent control, server enforcement and server-held credentials. Its cloud payload contains only the current user message. | Web-only, draft and unmerged; no history/memory transfer, durable jobs or native synchronization. |
| Durable tasks | The native stack contains lifecycle records, worker leases, attempts, checkpoints, East restoration and a PostgreSQL adapter implementing transactions, row locking and version comparison. | Native transport, transactional dispatch/outbox, production composition and deployment, tenant/RLS enforcement and end-to-end reconnect/cancellation remain unverified or unwired. Separate PostgreSQL integration CI is not native cloud synchronization or a production deployment. |
| Native memory | AES-256-GCM vault with a Keychain `WhenUnlockedThisDeviceOnly` key and explicit user CRUD. | Deliberately no automatic chat ingestion, retrieval into model context, cloud sync or TypeScript/native memory bridge. The web composition still uses `FileMemoryStore`; native encryption must not be generalized to every product surface. |
| Authority and evidence | Existing code preserves the distinction between model output, evidence candidates and authorization. East lifecycle results remain `authorized: false`. | Main's APEX trust source remains a placeholder. Production cloud action execution requires the actual authority integration; local hashes or returned `evidenceRefs` are not signed authorization receipts. |

Source references: [remote provider](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873/packages/intelligence/serverless/RemoteInferenceProvider.ts), [native composition](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/ios/PocketAILab/LocalChatView.swift), [draft cloud adapter](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/2d15997ad4238c0a88ce2e42223c062c711f109f/apps/web/cloudProvider.mjs), [PostgreSQL adapter](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/packages/intelligence/autonomy/PostgresTaskLifecycleStore.ts), [East adapter](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/packages/intelligence/autonomy/EastTaskLifecycleAdapter.ts), [native memory boundaries](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/docs/implementation/ios-native-encrypted-memory.md), [web memory composition](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873/apps/web/memoryRuntime.ts), [APEX trust source](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873/packages/director/src/lib/apex/trust.ts).

### Provider classification must precede broader offloading

The older TypeScript llama adapter accepts any HTTP(S) hostname. Agent Team and Director can use that path without PR #152's named-cloud-route consent check. Therefore an adapter called “local” is not evidence that the destination is local. Native Swift's loopback engine does enforce its loopback boundary.

Define a shared classification of actual destinations and capabilities: on-device, loopback, explicitly configured private host, and external cloud. Apply the appropriate disclosure and authorization rules to every route, including redirects. A change of endpoint or provider invalidates any consent whose scope did not include that destination. Do not treat the existing web checkbox as universal remote protection.

Sources: [TypeScript endpoint validation](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/2d15997ad4238c0a88ce2e42223c062c711f109f/runtime/adapters/llama-cpp/config.ts), [native endpoint validation](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/runtime/ios/Sources/PocketLlamaEngine/LlamaEngineSupport.swift).

## 2. Division of responsibilities

| Responsibility | Phone / native app | Optional cloud |
| --- | --- | --- |
| Interaction and continuity | Task history, model/location labels, offline edits, local results and pending work. | Durable accepted-job status and results for later retrieval. |
| Inference | Qualified small model for eligible tasks, within measured memory/context limits. | Qualified larger model for selected difficult or resource-heavy tasks. |
| Agent structure | Existing logical roles, coordination and assessment requirements. | Selected inference calls or authorized worker steps; no replacement of the collective process. |
| Private information | Device-local vault and local-only records by default. | Only the specifically approved task snapshot and explicitly selected records. |
| Execution authority | Existing host-owned checks for local actions. | Authenticated host checks at every remote execution boundary, including resume. |
| Long-running work | Submit, observe, request cancellation and reconcile when connectivity returns. | East-backed task execution, bounded leases, checkpoints, budgets and independent cancellation handling. |
| ExploitGym | Interface, task/evaluation history and local-model participation where supported. | Isolated Linux workload host and optional cloud-model inference, recorded separately. |

Proposed routing modes:

- **Local:** use the selected eligible local profile; show unsupported or unavailable capabilities honestly.
- **Cloud:** use the selected authorized remote profile and its approved payload. A provider outage is visible.
- **Automatic:** use a declared policy over task capabilities, measured model qualification, context/resource limits, privacy, connectivity, cost and user preference. It may choose only approved routes; it does not grant permission to upload data.

Model confidence or a model's request for “more intelligence” is not by itself a routing or authorization decision. Manual selection stays exact. Any permitted fallback creates a separately attributed attempt, and must not blindly replay a remote action whose outcome is unknown.

## 3. What synchronization means

| Item | Proposed treatment |
| --- | --- |
| Conversation and task records | Stable identities, revision numbers, authorship, timestamps, selected messages and task relationships. Rebuild appropriate context for each model. |
| Checkpoints and attempts | Task/operation/attempt IDs, input revision and hash, status, lease/fencing metadata, authorization reference, deadline, resource usage and result references. Application checkpoints are not portable GPU execution state. |
| Findings and memory | Preserve source/model provenance and proposed-versus-user-confirmed status. Cloud output does not become verified memory automatically. |
| Artifacts and evidence | Cache the approved bytes needed for offline use, with content hashes and bounded storage. A cloud URL alone is not an offline artifact. Keep fuller evidence alongside a compact, source-linked summary where the local context window requires it. |
| Weights and adapters | A separate exact-artifact installation/update process with compatibility, integrity, license, behavioral and device checks. No automatic model update during record sync. |
| KV caches and latent representations | No generic cross-model transfer. Different models do not share a portable hidden state merely because both are served through the same interface. GIE learned alignment remains a separate, versioned research and acceptance track. |

The present native notebook does not automatically feed the model. A later bounded context builder, or explicit user selection, must turn approved synchronized records into inference input. Synchronization makes information available; retrieval and prompting determine which information the local model actually sees.

For example, an approved cloud analysis can return a report, supporting references and a proposed patch. The phone downloads selected result bytes. Later, offline, the local model can explain or work from that report if it is supplied as context. The small model does not thereby acquire the ability to independently reproduce all of the larger model's analysis, and unsupported follow-up tasks remain cloud-dependent.

DeepSeek's chat API requires the client to supply conversation context on subsequent requests. Provider context caching is an optimization, not Pocket's authoritative memory. “Stateless” chat semantics do not establish a provider's retention policy. PEFT adapter checkpoints depend on their matching base model/configuration; they are not general patches for unrelated models. See [DeepSeek multi-round chat](https://api-docs.deepseek.com/guides/multi_round_chat/), [context caching](https://api-docs.deepseek.com/guides/kv_cache/), [PEFT checkpoint format](https://huggingface.co/docs/peft/en/developer_guides/checkpoint) and [Transformers cache explanation](https://huggingface.co/docs/transformers/en/cache_explanation).

## 4. Disclosure, encryption and recovery

Construct an explicit outbound task schema before calling the remote transport. Select fields and artifact bytes intentionally; never serialize the complete local task, memory vault or `InferenceRequest` merely because a provider accepts it. Provider credentials belong on the server; the phone uses bounded application credentials. Enforce endpoint identity, TLS, account isolation and payload limits.

Keep three distinct policies: local-only information; information approved for encrypted synchronization/backup; and readable task input approved for remote computation. Encryption in transit and at rest does not make ordinary inference input invisible to the service processing it. Cloud storage permission is not permission for an inference provider to read that content.

Preserve the native vault's device-bound key. Copying its ciphertext is not a complete cross-device recovery design and does not let a cloud model read its contents. A future portable encrypted record store or recovery-key system requires a separate key-management and recovery decision. The locked-device and missing-key behavior must remain explicit; synchronization must wait rather than fall back to plaintext.

Bind each queued payload to the account, destination, input revision and approved scope. Immediately before dispatch, recheck expiration, withdrawal, record deletion and account identity. A frozen snapshot must not override later withdrawal. Once content has already been delivered, local deletion or revocation cannot retroactively unsend it; remote deletion and retention need their own observable contract. Deletion tombstones must prevent stale sync from restoring removed records.

## 5. Durable handoff and return

1. **Persist locally before sending.** Record task ID, operation ID/idempotency key, input revision/hash, provider profile, selected payload, authorization scope, deadline and resource limits in a durable outbox. Do not create a new operation just because the connection changes.
2. **Accept durably on the server.** Authenticate the account and worker boundary, validate the payload and scope, bind the idempotency key to its payload hash, and atomically record acceptance plus dispatch intent. Reject reuse of an ID with different content. Client-generated IDs alone do not provide deduplication.
3. **Execute through the existing lifecycle.** Preserve task identity and distinct attempt IDs. Reuse East checkpoints and leases; recheck authority, expiry and remaining resources before each consequential step and after resume. Fence stale workers. A completed inference or successful lifecycle result does not authorize an action.
4. **Treat disconnection as uncertainty.** If acknowledgment is lost, query the same operation or retry its idempotent submission. Do not assume failure or resubmit a new job. Previously authorized cloud work may continue while the phone is disconnected only within its explicit continuation contract.
5. **Store results independently of the phone connection.** Persist status, bounded outputs, artifact references/hashes, actual model/provider identity, usage and failure details. Streaming is a presentation convenience, not the authoritative job record.
6. **Reconcile on return.** Download approved results, verify bindings and integrity, and attach them to the originating task revision. Results for an older revision become a stale proposal or branch for review, not an overwrite of newer local edits. Keep original evidence and attempt attribution.
7. **Report cancellation accurately.** Distinguish cancellation requested, cancellation acknowledged, completed and unknown remote outcome. Client timeout or an aborted stream does not prove server execution stopped. Side-effecting tools need their own idempotency and receipts; job-level deduplication is insufficient.

Use bounded retries and backoff. Do not claim universal exactly-once execution. Google Cloud Tasks documents possible duplicate executions; AWS documents why a timeout can occur after an operation has already produced a side effect. See [Cloud Tasks pitfalls](https://docs.cloud.google.com/tasks/docs/common-pitfalls) and [timeouts and retries](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/).

## 6. iPhone background behavior

The cloud must own an accepted job's durability; the phone should not need to maintain an open socket or continually run inference for that job to progress. Synchronize in the foreground and opportunistically in the background, with visible last-known status and a manual refresh path.

Current iOS supports user-started continued processing, including background GPU use on supported devices with the required capability. It is still subject to scheduling, expiration, cancellation and termination, so it is not an always-running phone-worker guarantee. Background URLSession supports durable file transfers, with file-backed uploads required to survive app exit; force-quit behavior differs from ordinary system termination. Cache and reconcile on relaunch.

CloudKit/CKSyncEngine is a possible personal-record synchronization mechanism. Its automatic timing is indeterminate, its state must be persisted, and application-specific conflicts still require handling. It does not replace an inference host, East's durable job semantics or authorization. Choose one authoritative owner for each kind of record instead of allowing unrelated sync systems to overwrite each other.

Sources: [Apple continued processing](https://developer.apple.com/documentation/backgroundtasks/performing-long-running-tasks-on-ios-and-ipados), [background downloads](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background), [background session configuration](https://developer.apple.com/documentation/foundation/urlsessionconfiguration/background%28withidentifier%3A%29), [CKSyncEngine](https://developer.apple.com/documentation/cloudkit/cksyncengine-5sie5).

## 7. Model and hosting choices

Use the [model-selection research](../research/model-selection-20261120.md) as candidate input, not as acceptance evidence. A qualified small local profile remains necessary. DeepSeek is a reasonable remote-provider candidate, alongside other providers supported by the abstraction; model quality must be measured on Pocket's tasks.

Start with a metered model API and an on-demand host for the gateway/worker when needed. This is an engineering recommendation for the initial experiment: it limits infrastructure work and avoids committing to an idle dedicated GPU before usage is measured. It is not a guarantee that an API is always cheaper. Managed GPU services can also scale to zero; compare real latency, utilization, token charges, worker runtime, storage and transfer costs before choosing dedicated inference hosting.

A DeepSeek adapter must translate Pocket's approved input and output contract to its documented chat API, handle actual provider/model attribution and token usage, and preserve failure behavior. Replacing only `baseUrl` in the generic `/v1/generate` provider is insufficient. Resolve model aliases when possible and record the observed identity; hosted versions may be less reproducible than pinned local artifacts.

Enforce application-level admission limits for requests, input/output tokens, wall time, concurrency and configured spending policy. Provider controls are additional defenses. Google Cloud alerts-only budgets do not cap spending; separate spend-cap budgets support specified services and have their own limitations. Do not invent an owner-selected dollar limit or promise an instantaneous billing cap.

Sources: [DeepSeek API model table](https://api-docs.deepseek.com/quick_start/pricing/), [Cloud Run GPU configuration](https://docs.cloud.google.com/run/docs/configuring/services/gpu), [Google Cloud budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets), [spend-cap budgets](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).

## 8. ExploitGym and honest evaluation

Keep ExploitGym at its existing authorized, isolated host boundary. A cloud worker can supply that Linux environment while the phone remains the interface. Inference location and workload-execution location are separate facts: a local model can propose actions to a remote sandbox, or a cloud model can supply the inference. Each needs its own supported adapter and authorization contract.

Retain the upstream source pin and task isolation described in [PR #165's integration boundary](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/b89d0bffd319ba940b17c50ee971fa1674dd541f/docs/integrations/exploitgym.md). The [model-selection research](../research/model-selection-20261120.md) separately documents the upstream adapter requirements and distinction between `flag_captured` and `on_target` scoring. This remains an integration plan; no Pocket ExploitGym run is established here.

Evaluate local, cloud and hybrid configurations under distinct names. Freeze prompts, task selection, output parsing, inference settings, budgets and failure accounting before measuring each new configuration. A combined workflow's score belongs to the combined workflow, with cloud usage disclosed. Preserve local-only offline tests and all previous raw/chat failures. Cloud success does not retroactively change the frozen 0/36 strict-format result or prove a learned GIE mapping.

## 9. Staged delivery and acceptance

The next implementation should be a bounded extension, after refreshing current branch ownership and reconciling dependencies:

1. Reconcile provider classification and consent across all host/native paths. Define the approved outbound schema and model/location attribution. Preserve manual-selection semantics.
2. Add one explicit native-to-cloud, read-only analysis path through a provider-specific gateway. Use an already reviewed local path as the offline baseline and preserve collective-role requirements. Measure actual quality, latency and usage.
3. Connect the native outbox/inbox to the existing durable lifecycle and status/result API. Add server dispatch, authentication, tenant isolation and cancellation integration. Do not enable consequential cloud actions before their real APEX authority path exists.
4. Add opt-in synchronization of selected records and artifact bytes with revision conflict handling. Connect explicit/bounded context retrieval separately; do not turn the native notebook into automatic cloud context.
5. Integrate the isolated ExploitGym worker and evaluate each inference configuration honestly. Keep model installation, distillation and GIE alignment on their separate acceptance tracks.

| Acceptance case | Required observable outcome |
| --- | --- |
| Offline launch and eligible local work | Local execution and local records remain usable; cloud-dependent work is clearly unavailable or queued. |
| No disclosure authorization | No remote payload leaves through any adapter, including a nominally local provider configured with a remote endpoint. |
| Connection loss before/after acceptance | One durable operation identity; query/retry does not silently create another task or side effect. |
| Phone suspension, termination and restart | Accepted server job and locally persisted pending state can be recovered; no promise of fixed background sync timing. |
| Cancellation, deadline or budget exhaustion | Accurate terminal/uncertain status; no new unauthorized work; actual remote cancellation behavior is measured. |
| New local edits while cloud runs | Result remains bound to its input revision and cannot overwrite newer content silently. |
| Revoked/deleted data before queued dispatch | Submission is blocked or reconstructed under a new valid scope; stale records do not resurrect deleted data. |
| Account change or locked/missing vault key | Correct account isolation and fail-closed storage behavior; no plaintext fallback. |
| Cloud result used offline | Required approved bytes are present locally and selected into context; source and actual model remain visible. |
| Quality comparison | Distinct local/cloud/hybrid results with every failure, actual resource usage and unchanged historical evidence. |

These are proposed acceptance cases, not tests executed in this documentation task. Provider choice, credentials, a monetary allowance, deployment and any cross-device recovery policy remain concrete later decisions; none is needed to preserve this design proposal or the existing local work.

## Work performed for this proposal

Read-only repository audit and current primary-documentation research, with independent internal review. No model weights downloaded, inference requests sent, paid service used, workloads launched, production code modified, tests rescored, PR merged or infrastructure deployed. Publish this proposal, its ownership/status row and an append-only log entry on `agent-coordination`; keep it in-review.

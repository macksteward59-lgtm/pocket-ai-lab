# Google Cloud analysis component

## Status and integration decision

This additive foundation supplies a regional Vertex AI `InferenceProvider`, an offline selected-text preview, and a worker that attaches candidate evidence to a supplementary lifecycle record linked to an existing Pocket AI Lab task. Its deterministic tests exercise the actual provider and the existing task lifecycle with explicitly injected fixtures. No hosted Google agent, live model qualification, production deployment or native Google UI is established by those tests.

The branch starts from native cloud-analysis PR #236 at `e38c80144e06f51d9809c35971f53ac25d0841f5`. That existing implementation already owns the native cloud sheet, gateway, local task archive and DeepSeek transport. Its gateway and Swift client are deliberately DeepSeek-specific. This component does not substitute Google behind that disclosure and does not add another HTTP gateway or orchestrator.

| Existing component | Reuse in this slice |
| --- | --- |
| `InferenceProvider` / `InferenceRequest` | Vertex transport implements the existing model abstraction. |
| `AgentProfile` / `AgentManager` | Stable permanent component identity, explicitly registered by a host; no new agent manager. |
| Cloud-analysis validation and limits | Exact bounded UTF-8, SHA-256, canonical UUIDs, bounded JSON streaming and abort racing. |
| `TaskLifecycleCoordinator` | Atomic task creation, worker-owned claim, completion/failure events and conservative expired leases. |
| `PostgresTaskLifecycleStore` | Existing production-store integration point; deployment and transaction/IAM configuration remain host responsibilities. |
| Pocket AI Cloud plugin | Same three-field selected-text input. The installed Python manual runner remains intact; this worker adds repository lifecycle/provenance integration. Their preview formats and digests are distinct and not interchangeable. |

## One logical agent across engineering and operation

The durable logical agent ID is `pocket-google-cloud-analyst`; its component is `google-cloud-text-analysis`. `googleCloudAgentProfile()` returns that same identity each time, with no action permissions. It does not register itself or acquire credentials at import.

The component's engineering work, release record, operating runbook and job evidence must use those IDs. A worker process receives its own existing lifecycle `ownerId`; that ephemeral concurrency owner is separate from the logical component agent. A model version is also separate from agent identity.

| Stage | Responsibility | Authority |
| --- | --- | --- |
| Build | Maintain the scoped component, tests and draft PR. | Repository engineering identity. |
| Release | Present source commit, artifact digest and test evidence. | Independent authorized release owner or APEX policy. |
| Operate | Analyze approved documentation, test summaries or designs. | Runtime identity limited to the selected Vertex resource. |
| Improve | Return operational findings to the original task owner and propose a new change. | New engineering/release path; runtime does not gain repository write or deployment permission. |

`releaseID`, `commitSHA` and `artifactSHA256` are explicit provenance assertions bound into each preview. Their presence or a matching hash does not prove a signed release. The injected release verifier must validate the independently approved release. Persistent context and release records remain with the existing task owner; this ID alone is not a hosted persistent process or private-memory synchronization.

## Preview: no credentials or network

`scripts/google-cloud/preview.mts` reads bounded UTF-8 JSON on stdin with exactly:

```json
{
  "task_id": "an-existing-pocket-task",
  "purpose": "test-summary",
  "selected_text": "Exact selected report text goes here."
}
```

Supported purposes are `documentation`, `test-summary` and `design-review`. No attachments, full conversations, task histories, vault contents or workspace traversal are accepted. The user or authorized host must inspect the selected material for sensitive content and permitted purpose before approval. This workflow is not for exploit development, offensive automation or vulnerability reproduction; a purpose label is not a content-classification guarantee.

Supply explicit configuration:

| Environment variable | Meaning |
| --- | --- |
| `POCKET_VERTEX_PROJECT` | Google project ID. |
| `POCKET_VERTEX_LOCATION` | Explicit regional location; `global` is rejected. |
| `POCKET_VERTEX_MODEL` | Google publisher model ID available in that region. No default, alias substitution or fallback is selected. |
| `POCKET_CLOUD_AGENT_RELEASE_ID` | Operator's release identifier. |
| `POCKET_CLOUD_AGENT_COMMIT_SHA` | Forty-character lowercase source commit SHA. |
| `POCKET_CLOUD_AGENT_ARTIFACT_SHA256` | Sixty-four-character lowercase release artifact SHA-256. |
| `POCKET_CLOUD_AGENT_ATTEMPT_ID` | Optional UUID. If absent, a new UUID is generated for the preview. |
| `POCKET_VERTEX_MAX_OUTPUT_TOKENS` | Optional integer 1–512; default 512. |

With those values configured, run:

```sh
node --import tsx scripts/google-cloud/preview.mts < selected-text.json
```

This command does not call Google, look up credentials, create a task or approve a release. It prints the exact complete Google body, endpoint, project/region/model, output cap, originating task, stable agent/component, release identity, attempt, five-minute expiry and digest. The preview includes fixed analysis instructions as well as the exact selected text. A newly generated attempt or expiry changes the digest. The preview is sensitive because it includes the selected text; do not commit real previews to the public repository.

The worker reconstructs the preview before using it. Unexpected fields, changed instructions, tools, destination/model/cap changes, stale consent, malformed Unicode and non-JSON getters or serialization hooks are rejected. The digest is a change detector; it is not an APEX receipt, signature or permission grant.

## Authorized host integration

`GoogleCloudAnalysisWorker` is an explicitly constructed, host-injected callable. There is intentionally no permissive submit CLI or public HTTP listener. The existing local task owner supplies:

- An explicitly enabled `VertexAnalysisProvider` configured for the exact preview destination.
- An initialized `TaskLifecycleCoordinator` with a suitable atomic store.
- `taskExists(taskID)`, establishing that the originating local task exists and is available to this owner.
- `verifyApproval(preview, receipt)`, independently validating permission for this exact selected-text export, destination, expiry, attempt, output budget and applicable APEX scope.
- `verifyRelease(release)`, independently validating the source/artifact permitted to operate.
- A server-held token callback for the runtime identity; no Google credentials in the iPhone client, selected text, task record or preview.

The worker's API is:

```ts
const evidence = await worker.run({
  preview: reviewedPreview,
  approvedDigest: reviewedPreview.digest,
  receipt: independentlyIssuedReceipt,
  signal
});
```

Matching `approvedDigest` is necessary but insufficient. Missing callbacks, denied/throwing verifiers, a missing original task or a mismatched provider prevent dispatch. Verification callbacks are read-only inspections and may be invoked more than once; the lifecycle reservation supplies one-use execution accounting. Model text is never used to generate approval or an authorization receipt.

### Reserve before dispatch; preserve uncertainty

For each attempt, the worker creates a deterministic **supplementary** task, `google-cloud-analysis:<attempt UUID>`, and claims its single step before entering the provider. Metadata ties it to the original task, preview digest, release and agent identity. `maxAttempts` is one and `uncertainOnExpiredLease` is true. The original task's outcome is never overwritten.

The duplicate task ID blocks replay even if input, task ID or approval changes. A caller must not delete reservations to retry an uncertain request. Independent attempts still require fresh exact approval. Atomic store failures before provider entry prevent dispatch. A post-dispatch failure is reported conservatively as unknown; the worker attempts to record that state without retrying the model request. If the store cannot settle, the retained reservation/lease remains available for the existing conservative recovery path. No local cancellation proves Google stopped processing a request.

The worker bounds preflight, credential acquisition and provider work, and rechecks consent after asynchronous operations. It revalidates task availability, release and exact approval after credential acquisition, before fetch, so a slow credential lookup cannot bypass a revoked host decision. A final synchronous check immediately before fetch also catches expiry during token acquisition or a wall-clock jump. An uncooperative callback cannot resume a cancelled public operation into a later dispatch. Host authorization checks still define their own consistency/revocation semantics; this component does not make distributed policy changes atomic with Google's execution.

The in-memory fixture store proves ordering and reconstruction behavior in tests; it is not cross-process durable storage. The existing PostgreSQL store uses optimistic snapshot concurrency. A production host must retain one authoritative store/namespace across workers and restarts, initialize it correctly, and handle conflicts through existing owner reconciliation. This slice adds no new database, store migration, poller, automatic retry or East execution bridge.

### Provider and result contract

The transport uses one `generateContent` request to:

```text
https://REGION-aiplatform.googleapis.com/v1/projects/PROJECT/locations/REGION/publishers/google/models/MODEL:generateContent
```

Only the exact selected text and fixed instructions/configuration enter the body. Task IDs, agent IDs, attempts, release metadata, receipts and credential values stay out of it. The region is validated in both hostname and resource path. Redirects, automatic retries, model fallback, tool declarations, file input and safety-setting overrides are absent.

Thinking remains **model-default**; the component does not send model-specific disabling flags or claim that thinking is off. The result retains thought-token usage and cached-token counts separately. `maxOutputTokens` is a generation parameter, not a dollar spending guarantee. Budget admission belongs to the independent host policy. Model availability and the chosen model's useful completion rate under this cap require later approved measurement.

Only one completed `STOP` candidate with bounded final text is accepted. Safety-blocked, truncated, continuation, tool, media, returned-thought and malformed responses fail conservatively. Provider-reported model/version and response ID are preserved separately from the requested model; they are not immutable weight attestations. A thought signature, if present with final text, is not copied into evidence. Token accounting checks prompt + completion + thoughts + tool-use = total; tool-use must be zero and cached tokens are already included in prompt tokens.

Success returns `kind: "cloud-analysis-candidate"`, `authorized: false`, `verified: false`, and the original task/attempt/agent/component/release/destination/input-digest bindings. It is stored only in the supplementary lifecycle record. The original task owner must inspect/reconcile it as candidate evidence. It is not a signed `Evidence.swift` record, a local-model result, a verified memory write or a change in action authority.

## Validation

The dedicated `Google Cloud Agent Foundation` workflow checks the exact PR source head, including stacked PRs. It runs the project typecheck, explicit operator-entrypoint typecheck, new preview/provider/worker tests and the existing cloud gateway regressions. Tests use declared credential/transport/store fixtures and require no cloud secrets.

```sh
npm install --ignore-scripts --no-audit --no-fund
npm run build
npx tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --strict --esModuleInterop --skipLibCheck scripts/google-cloud/preview.mts
npx vitest run packages/intelligence/cloud/google-cloud/*.test.ts scripts/google-cloud/preview.test.ts packages/intelligence/serverless/cloud-analysis/cloudAnalysis.test.ts
```

Coverage targets include exact outbound equality; disclosure and release/approval binding; credential isolation; provider parsing and bounded streams; expiry while awaiting credentials; pre-dispatch persistence failures; post-dispatch uncertain settlement; concurrent/restarted attempt rejection; and preservation of original task results. Fixture success does not establish real Google model quality, a working cloud deployment or physical iPhone readiness.

## Remaining integration gates

1. Reconcile PR #236 and coordinate provider-neutral gateway plus native consent/response contracts. Explicitly disclose Google destination and provenance; the existing DeepSeek profile cannot be relabeled silently.
2. Supply real independent approval/release verifiers, task ownership, authoritative storage and budget policy through the existing host. This worker does not replace APEX/East.
3. Review the release artifact and prepare scoped runtime identity/hosting under the independently authorized release process. Keep repository, deployment/IAM and runtime credentials distinct.
4. Obtain approval for one exact selected-text preview, run one real Google job, and reconcile its candidate record against the original Pocket task. A failed/ambiguous submission requires investigation and fresh approval before any new attempt.
5. Validate native integration and physical iPhone behavior separately. Preserve the original local recipient benchmark and its acceptance rules; cloud analysis cannot qualify the local model retroactively.

## API references reviewed for this implementation

- [Google generateContent REST method](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/projects.locations.publishers.models/generateContent)
- [Google GenerateContentResponse and usage metadata](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1/GenerateContentResponse)
- [Google model-dependent thinking configuration](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/thinking)
- [Google application default credentials](https://docs.cloud.google.com/docs/authentication/application-default-credentials)

These references describe API behavior. The stricter selected-text, regional-only, approval, no-retry and candidate-evidence rules above are Pocket AI Lab component policy.

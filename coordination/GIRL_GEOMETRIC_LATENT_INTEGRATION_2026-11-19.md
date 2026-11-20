# Pocket AI Lab — G.I.R.L. / Neuralese Integration and End-to-End Proof-of-Concept Gates

**Recorded:** 2026-11-19 (owner discussion); coordination update 2026-11-20 UTC  
**Status:** Engineering integration contract and evidence plan; not a live deployment or proof of semantic latent interoperation  
**Owners:** ChatGPT, project engineering lead; the repository owner retains all protected decisions  
**Product anchor:** [Complete Product Handoff](POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md) and [Master Requirements](../docs/requirements/POCKET_AI_LAB_MASTER_REQUIREMENTS_CHECKLIST.md)

## 1. Source fidelity and original intent

The owner confirmed that **G.I.R.L. means Geometric Intelligence Representation Layer**. It was developed as a perspective for machine-to-machine/agent-to-agent communication using representations below ordinary natural-language exchange. Relevant adjacent ideas discussed include XYZ geometric framing, Neuralese/latent communication, Minimal Surface-inspired optimization, shared codebooks, relationship preservation, adaptive dimensionality, and model-independent multi-agent orchestration. This is a **design goal and hypothesis**, not evidence that heterogeneous LLMs possess a common, intelligible latent language.

The full historical original conversation and complete experimental definitions were not recovered verbatim; this document does not manufacture either the original Minimal Surface variable glossary or per-module six-layer/M01–M42 permission mappings. It uses **repository-authoritative** X/Y/Z: X = bounded token-level source vectors; Y = ordered temporal segments/pooled representatives; Z = product-quantized codebook indices and optional residual stages. Do not conflate this current GIE1 notation with unresolved earlier historical variables.

G.I.R.L. is an experimental **adapter/representation layer** inside Pocket AI Lab, **not** a replacement for Director/APEX, East/e3, MessageBus, model router, independent agent reasoning, native runtime, Evidence, or user-facing text.

## 2. Existing implementation and dependencies

| Dependency | Source or PR | Verified extent / integration gate |
|---|---|---|
| Typed agent control plane | `packages/intelligence/message-bus/`, AgentProtocol v1, PR #216 | Use unchanged JSON control plane with bounded references; no embedding arrays or invented message types in v1 |
| Authorized host latent channel | `LatentChannel.ts`, `LatentChannelRuntime.ts`, PR #218 | Same-model int8 codec and in-memory host demo; production APEX adapter, persistent replay and blob storage remain absent |
| Native latent access | PRs #219 and #222 | Final token and bounded generated-token sequence capture, respectively; cannot assume every installed model/runtime exposes compatible vectors |
| GIE sequence compression | PR #221, `PooledProductQuantizer.ts` | Pooled segment vectors, not original token-by-token reconstruction; same-model only |
| Canonical codebook | PR #223, `GIECodebookArtifact.ts` (GCB1) | Exact model ID/revision and SHA-256 artifact verification; digest alone is not publisher authentication |
| Native encoding | PR #224, `NativeGIESequenceEncoder.swift` | Native test parity is a hard gate; CI #44624919457 failed the original 62-byte shared fixture comparison, so do not describe current encoder as validated without a new exact-head pass |
| Relationship-aware hypothesis | PR #225, `MINIMAL-SURFACE-INFORMATION-REPRESENTATION.md` | Architecture only. Optional sidecar requires a separately versioned negotiated protocol and independent task-level quality evidence |
| Integrated native agent operation | Native coordinator, RuntimeController, ModelPool, LlamaEngine, BridgeGate | Must demonstrate **real provider-backed** distinct agent invocations, bounded sessions/cancellation, user-visible model attribution and host authority |
| Full product execution and evidence | Director/APEX, East/e3, Evidence, Memory, ExploitGym, Grok Workspace | Remain source-of-truth for authorization, durable task ownership, evidentiary claims, approved research scopes and artifacts |

All listed PRs must be reconciled by **current head SHA**, stacked base, changed files, required CI, review, and integration state. A draft PR or codec microbenchmark is not a product acceptance result.

## 3. Intended communication flow and safe fallback

1. **Director** assigns a task to actual model-backed logical agents; routing checks model/runtime availability, privacy, resources and policy. Agent roles are not models and capability labels confer no authority.
2. **Sender model** produces an attributable ordinary-language output and, if explicitly supported, a bounded hidden-state/vector export tied to exact model ID/revision, runtime, sequence shape/layer and task.
3. **Host capability negotiation** checks that the recipient supports the exact model-space/codec version/codebook, transfer size and scope. Unless there is validated model-pair alignment, only an **exact same-model compatible route** is eligible.
4. **APEX/Director host** independently authorizes the sender-to-recipient transfer for exact task, route, recipient, codec and expiry. East/e3 owns durable execution state. Model text/latent bytes cannot approve their own execution.
5. **G.I.R.L. candidate representation** may preserve declared ordering, spans, and explicit relationships. The current compatible baseline is GIE1 segment pooling and product quantization with immutable GCB1 artifact. Do not send the proposed MSIR sidecar in GIE1 v1.
6. **Data plane** stores the bounded binary blob out of band; the existing validated MessageBus carries only the typed metadata/blob reference. Verify digest, size, model/codebook identity, expiry, replay and task routing at receive.
7. **Recipient** reconstructs pooled vectors, checks supported input semantics, and performs a **real** recipient-model step; merely decoding a tensor is not evidence that another model understood it.
8. **Critic/Validator** evaluate information loss, relationships and downstream task quality; **Director** synthesizes and records evidence. Any unavailable/failed negotiation, decoder, authorization, quality, cancellation or adapter gate **fails closed to ordinary text or rejects the action**, as allowed by policy.

No cross-model semantic alignment is assumed from matching dimensions, the same tokenizer, a shared codebook or a plausible reconstruction. Research a trained/versioned alignment adapter only under held-out evaluation on the actual model pair.

## 4. Required experiment matrix — no performance overclaim

Under the same authorized task, model identity, hardware and evaluation set, compare:

A. Plain natural-language agent messages (truthful baseline).  
B. Raw same-model latent vectors (only where runtime supports genuine export/ingest).  
C. Existing affine-int8 channel.  
D. GIE1/GCB1 pooled/product-quantized sequence.  
E. GIE1 plus explicit versioned, provenance-bound relationship structure (after schema negotiation).  
F. Separately validated model-pair alignment or geometric regularization (only after methods and held-out evidence exist).

Measure total serialized control+binary bytes, reconstruction RMSE and segment-order/edge fidelity, **downstream recipient task accuracy**, actual model invocations, p50/p95 end-to-end latency, peak/temporary memory, battery/energy/thermal where supported, and cancellation/restart behavior. For physical iPhone Air acceptance, record device/build/model/hash, runtime/session/evidence IDs, network state, task input, repeated runs and raw results. Compression does not, without measurement, reduce model weight size, KV cache, attention compute, inference compute or total app memory.

## 5. Complete integrated product acceptance scenarios

| Scenario | Acceptance evidence required |
|---|---|
| **Offline native conversation** | Physical iPhone installs exact build, verifies a local GGUF, obtains real runtime readiness, generates and cancels offline, releases model lease; UI names actual local model |
| **Real collaborative agent task** | Director delegates to at least three logical roles; actual provider calls and distinct attributed messages exist; Critic challenges, Validator verifies, user sees truthful synthesis |
| **G.I.R.L. same-model exchange** | Two eligible agent steps exchange a negotiated GIE1/GCB1 blob through authorized route, consume it through a supported receiver adapter, complete a downstream task; text fallback tested on incompatible model/revision |
| **Durable workflow and memory** | East task survives interruption/restart with owner fencing, settlement and duplicate prevention; authorized memory has provenance, encryption, correction/deletion and project isolation |
| **Security/research tool action** | Use approved local/isolated fixtures, exact-scope APEX policy and human approval for protected actions; no external target is inferred authorized; evidence, independent review and revocation are demonstrable |
| **Resource failure** | Low-memory/thermal/cancel/network-loss conditions degrade transparently; model/specialist leases drain; no silent remote fallback, missing receipts, replay or misleading success |
| **Cross-model experiment** | A separately trained, independently tested versioned alignment adapter improves held-out downstream tasks versus text baseline; otherwise unavailable with text fallback and no compatibility claim |

The **same-model G.I.R.L. task scenario is NOT currently complete** merely because #221/#223 contain codecs and #219/#222 capture native vectors. It requires a recipient **consumption path** and task-level evaluation. Complete, audited integration is a later acceptance gate than a codec round-trip.

## 6. Integrated sequencing and dependencies

**Gate A — exact-head correction:** resolve #224 shared fixture parity with no GIE1/GCB1 wire change; re-run exact-head native CI; reconcile #225 stacked ancestry after #224 passes. Record failure and fixed commit precisely.

**Gate B — truthful native runtime:** reconcile currently open RuntimeController/BridgeGate/cancellation/Workspace branches by file-level ancestry; prove exact-model load/generate/cancel/unload on hosted native tests then on the physical iPhone. Do not merge divergent branches blindly.

**Gate C — real agent task:** route at least three provider-backed role steps through one native session/model-pool owner, typed MessageBus, Critic/Validator and attributable evidence; fail closed for unavailable model, missing authorization or interrupted step.

**Gate D — authorized G.I.R.L. route:** add opt-in same-model route integration in the existing host, with capability/version/codebook checks, bytes out of band, independent APEX decision, East task binding, replay/expiry checks, and tested text fallback. Keep sidecar/MSIR and cross-model alignment disabled until separately proven.

**Gate E — durability/knowledge:** wire genuine East provider-generation cancellation/settlement and restart recovery; integrate encrypted 4-class memory, knowledge and provenance. Do not equate an in-memory adapter with durable storage.

**Gate F — full product demonstrator:** visible native one-app journey across local inference, agent team, memory, approved tool action, task history/approval queue, evidence, offline/online transitions and measured iPhone resource limits.

## 7. Requirement and project accounting

The pre-existing **316-row November 16 traceability snapshot** is not the complete current product checklist: the subsequently appended advanced-security research requirements and the newly recovered G.I.R.L. requirements must be accounted for separately. The master requirements and traceability matrix must remain synchronized with stable IDs and no invented verified statuses.

**Hard open historical sources:** original M01–M42 detailed definitions, canonical six-layer per-module mappings and tier assignments, and the verbatim early geometric/Minimal Surface symbol glossary. Recovered M01–M42 *names* do not prove recovered permission maps.

**Out of scope:** automatic remote-provider execution without authorization; unsandboxed security testing; production-readiness claims from simulator CI; fabricated model responses; changing protected approval/merge/release rules; adding unrelated hardware-brand language.

This integration contract is the bridge between the owner's two-week design vision and reproducible end-to-end acceptance. It is not authorization to merge, sign, ship, deploy or test external targets.

# Pocket AI Lab — native bounded token capture to verified GIE1 adapter

**Status:** Unmerged integration candidate. This is one component of Pocket AI Lab's model-independent agent system, not a standalone product or a proof of model-to-model understanding.

**Inputs brought together:** [PR #222](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/222) (real bounded llama.cpp generated-token vector capture) + [PR #228](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/228) (production native GIE1/GCB1 encoder/decoder, canonical codebook fixture, independent native codec parity).

## What was integrated

- An immutable, ordered `LlamaLatentSequenceOutput` from the existing native engine: model ID, text, token count, vector dimension, and row-major Float32 generated-token vectors.
- `NativeInferenceRuntime.generateWithLatentSequence` from PR #222, preserving the existing model-pool lease, in-flight use pin, scheduler permit, cancellation drain, 256-token maximum, 16 MiB vector cap, request identity and output validation.
- `NativeGIECodebookArtifact.load` and `NativeGIESequenceEncoder`, previously tested against the canonical GCB1/GIE1 shared fixtures.
- **New `NativeGIECaptureEncoder`**: checks a caller-supplied exact model/revision and GCB1 artifact against the live lease before invoking inference; generates the bounded sequence through the already-existing runtime; then product-quantizes it into a versioned same-model GIE1 blob. Rejects mismatched identity, malformed shape, NaN/Infinity, invalid resource bounds, wrong digest, oversized payload and cancellation. The verified encoder exposes the smallest possible nonempty frame size, so an impossible payload budget is rejected before inference. A budget that can fit a short sequence is still checked against the actual encoded length afterward. It does not copy any underlying model or decoder implementation.
- An `encodeCaptured` method for synthetic testing only: its provider provenance is forcibly `.other`, so the caller cannot label arbitrary vectors as genuine llama.cpp inference using that method.
- Focused `NativeGIECaptureEncoderTests` with a declared fixture engine to check pre-generation codebook/identity/budget rejection, native runtime sequence requests, exact encoded bytes and decoded segment spans, unverified provider label, malformed tensor and payload-budget rejection. An admitted capture whose actual payload exceeds its budget must leave zero active model uses and scheduler requests while retaining the caller's lease.
- GCB1 identity validation compares UTF-8 bytes, including the bytes after NFC normalization and the expected identity. The adapter also requires byte-exact model IDs at its lease, session and captured-output boundaries. Swift's canonically equivalent `String` comparison cannot enforce this wire contract. Regression cases cover non-NFC artifact strings with correct digests, canonical artifacts paired with differently encoded expected identities, and decomposed lease/capture IDs; composed Unicode remains valid.

## Explicit trust and ownership boundaries

1. **Only a trusted host can supply authoritative model identity.** The `expectedModelIdentity.modelRevision` and expected codebook hash are host inputs. This adapter checks consistency but **does not independently verify installed GGUF bytes, publisher signature, model revision authenticity or Evidence receipts**. An APEX/Director-controlled host must prove or supply those elsewhere before an operational transfer.
2. **The native runtime retains inference authority.** The adapter does not replace ModelPool, InferenceScheduler or cancellation/drain; it delegates all generation to `generateWithLatentSequence`. A mock injected into the runtime remains a mock, with provider kind derived from the runtime-owned engine rather than a supplied label.
3. **The compressed sequence is lossy.** GIE1 returns ordered *pooled* segment vectors. Original per-token vectors, hidden-layer meanings and model KV cache cannot be reconstructed. This adapter neither declares semantic equivalence nor turns pooled vectors into input that a recipient llama.cpp runtime can consume.
4. **No agent transfer occurs here.** GIE1 bytes are not an authorization receipt. APEX still needs to authorize the exact task/sender/recipient/codec/privacy; East owns durable task execution; the typed MessageBus retains JSON control metadata while separately protected blob storage handles payload bytes. Expiry, replay, key provenance and text fallback are still missing from this new integration slice.
5. **No performance or device claims.** A short fixture can exceed raw Float32 byte size after wire headers. Measure quality, latency, memory, thermal/battery and downstream task success on the physical iPhone before asserting compression benefits.

## Engineering and test evidence

The source merge was constructed as a non-force two-parent Git commit, preserving the full histories of PR #222 and PR #228. It copies PR #222's exact tested native C/Swift sequence-export sources and focused XCTest, while preserving the PR #224 whole-second frozen clock in the shared smoke test.

Two CI gates are independent:

- **Native integration source CI:** `.github/workflows/native-gie-capture-integration-ci.yml` typechecks the complete unlinked Swift engine on macOS, reruns the canonical Swift encoder/decoder fixture, and executes the real model-pool/scheduler/adapter with a declared fixture engine. The executable checks Unicode rejection, admission before generation, actual-size rejection after generation, and resource cleanup. It has no GGUF or full app build and cannot replace XCTest.
- **Full iOS LlamaEngine CI:** `.github/workflows/ios-llamaengine-ci.yml` includes the new PR base branch so the complete simulator/macOS/GGUF and app build matrix can run. It may be queued or cancelled by runner availability and must pass on the exact commit head before claiming integrated native success.

Do not treat the previous successful PR #222 native CI or PR #228 focused Swift CI as evidence of the *combined branch*. Both are prerequisite implementation evidence, not current integration acceptance.

### Real-GGUF capture-to-GIE smoke

`testPinnedGgufSmokeGenerationThroughNativeInferenceRuntime` now includes another genuine generation through `NativeGIECaptureEncoder.generate` using its already-loaded llama.cpp runtime and exact lease. It binds a test GCB1 artifact to the SHA-256 read from that GGUF, passes a capture byte budget derived from the live vector dimension, then decodes the resulting GIE1 with the production loader and decoder. It checks provider identity, text, token/dimension bounds, artifact digest, ordered segment spans, reconstructed shape, and payload length. Existing model-hash revalidation, lease release, unload and zero-reservation assertions remain; the scheduler must also be idle.

The codebook is **synthetic and untrained**: one scalar subspace per dimension, two centroids `[-1, +1]`, one residual stage and at most four tokens per segment. Its only purpose is to execute the combined path. The shared fixture remains the exact-byte parity gate; separate native generations are not required to produce identical quantizer indices near a decision boundary. No compression-quality or recipient-task success is asserted.

The existing macOS XCTest step supplies the verified pinned model path. Simulator runs without that path skip this real-model smoke. On execution, the test emits `POCKET_LLAMA_GIE_CAPTURE` with the actual provider, GGUF digest, codebook digest, tensor dimensions, segment count and payload size, explicitly labeled `codebook=synthetic-untrained`. Adding this source does not itself establish a passing run: inspect the exact-head native CI conclusion and marker before recording success. The hash binding in this test is not a production publisher-attestation mechanism.

## Required next steps

1. Pass exact-head combined Swift source CI and full native simulator/macOS XCTest, including the real-GGUF adapter marker. Resolve compiler/test failures with a scoped patch on this feature branch only.
2. Add host-attested model GGUF revision provenance and model/readiness receipts, with fail-closed handling on session changes.
3. Add APEX-authorized sender/recipient route and separately bounded persisted blob storage, expiry/replay protections and text fallback. Reuse existing typed MessageBus and East/e3 task lifecycle; do not invent a second authorization engine.
4. Create a receiver-side **real model inference API** that can actually ingest the declared pooled embeddings, or keep the latent transfer route disabled and use ordinary text. Compare against text baseline on held-out tasks; do not label a decoded vector as model understanding.
5. Complete native iPhone Air offline, interruption/restart and memory/thermal/battery acceptance. No hosting CI equals physical-device acceptance.

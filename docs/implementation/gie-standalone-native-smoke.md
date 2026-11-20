# Standalone native GIE1/GCB1 source parity check

**Status:** Test-only integration candidate. This is one validation slice of the unified Pocket AI Lab product, not a second encoder or a new application.

**Parent:** PR #226 — verified GCB1-backed Swift/TypeScript GIE1 round trip. The standalone check uses the exact existing shared JSON fixtures from PRs #223 and #226 and the real production Swift source files from PRs #221–224.

## Problem being isolated

The existing full native iOS/macOS CI has repeatedly returned `cancelled` during the generated Pocket AI Lab app build. Cancellation is not evidence of a source-code defect or proof of correctness. The full workflow also spends time compiling pinned llama.cpp before reaching the GIE Swift XCTest. A narrowly scoped check is useful while preserving, rather than replacing, the full required native matrix.

## Actual execution path

The dedicated CI workflow uses macOS Swift tooling and compiles these existing source files without editing them:

- `NativeGIESequenceCodec.swift` — production GIE1 decoder and codebook structural validation.
- `NativeGIECodebookArtifact.swift` — production GCB1 loader and CryptoKit SHA-256 check.
- `NativeGIESequenceEncoder.swift` — production GIE1 encoder.
- `runtime/ios/Tests/GIEStandaloneSmoke/main.swift` — a small test entry point with a **build-only** definition of `NativeLatentModelIdentity` (model ID and immutable revision).

The native code under test is exactly the same source used by the app. The test entry point does not redefine encoding/decoding, change production types, or create any new model runtime or authorization path.

The standalone binary reads the existing `gie-codebook-artifact-v1.json` and `gie-verified-sequence-v1.json` resources. It must verify the SHA-256 digest and model identity, encode the fixture's bounded token vectors, compare the **exact bytes** with the TypeScript-produced GIE1 fixture, decode ordered spans and pooled vectors, and reject a tampered payload digest, tampered artifact bytes, and a foreign model ID.

## Run

This check requires **macOS + Xcode/Swift with CryptoKit**. It does not require llama.cpp, a loaded GGUF, XcodeGen, a simulator, or an Apple signing identity.

From the repository root:

```bash
swiftc -swift-version 5 \
  runtime/ios/Sources/PocketLlamaEngine/NativeGIESequenceCodec.swift \
  runtime/ios/Sources/PocketLlamaEngine/NativeGIECodebookArtifact.swift \
  runtime/ios/Sources/PocketLlamaEngine/NativeGIESequenceEncoder.swift \
  runtime/ios/Tests/GIEStandaloneSmoke/main.swift \
  -o /tmp/gie-native-smoke

/tmp/gie-native-smoke \
  runtime/ios/Tests/LlamaEngineTests/Fixtures/gie-codebook-artifact-v1.json \
  runtime/ios/Tests/LlamaEngineTests/Fixtures/gie-verified-sequence-v1.json
```

Expected successful output begins with `POCKET_GIE_STANDALONE_OK`. Any mismatch must exit nonzero with `POCKET_GIE_STANDALONE_FAILED`.

## What a pass does **not** establish

- No native iOS app build, iOS simulator XCTest, pinned GGUF smoke inference, native runtime session, or physical iPhone Air test.
- No usable model embeddings, recipient-model ingestion, cross-model semantic alignment, downstream task quality, or production G.I.R.L. route.
- No Director/APEX authorization, East durable task ownership, replay protection, trusted publisher identity, signed Evidence, or data privacy assessment.
- A verified SHA-256 of expected artifact bytes does **not** establish a trusted codebook publisher or permission to use the codebook.

The original full app CI and test runs remain required. Do not mark Pocket AI Lab requirements as verified simply because this isolated check passes. Keep the codebook/codec stack draft until exact-head integration evidence is complete.

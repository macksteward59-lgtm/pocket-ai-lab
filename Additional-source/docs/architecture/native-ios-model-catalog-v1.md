# Native iOS local model catalog v1

## Purpose

The iOS app now maintains a device-local catalog of imported GGUF artifacts and an explicit selected-model preference. The catalog separates **inventory**, **selection**, and **runtime readiness**:

1. Import validates a minimum supported GGUF header, copies through a staging file, computes SHA-256, and only then registers the artifact.
2. The destination filename includes the full SHA-256 digest. Two different models with the same original filename therefore coexist instead of overwriting each other.
3. Catalog entries persist a content-addressed ID, display name, private filename, digest, byte count, conservative memory estimate, context default, generic text-generation capability, and import timestamp.
4. Selection persists separately from load. Restarting the app restores the selected artifact but does not create a native runtime session.
5. Load re-computes the file fingerprint before and after native load. A changed or unreadable artifact fails closed.
6. The current iOS pool remains configured for one resident model and one concurrent inference request. Multiple models may be cataloged; only one is selected/loaded at a time in this UI.

## Storage and bounds

- Catalog archive: `Application Support/PocketAILab/ModelCatalog.json`.
- Model files remain in the app-private `Documents/Models` directory.
- Maximum 100 catalog entries and 256 KiB encoded archive.
- Atomic archive writes.
- On iOS, catalog file/directory use `completeUntilFirstUserAuthentication` protection and are excluded from device backup.
- Model files are not removed when catalog selection changes. This phase intentionally does not add destructive model deletion.

## Trust boundaries

- Catalog membership does not mean a model file is loaded, runtime-ready, authentic, or attested.
- SHA-256 is byte identity and tamper detection relative to the stored digest, not publisher authenticity or provenance.
- Memory estimates are admission hints, not measured resident memory or KV-cache usage.
- Context length and quantization are not parsed from GGUF metadata yet. The current catalog uses a conservative 2,048-token default and explicitly labels quantization metadata as unparsed.
- The generic `text-generation` capability is not a verified task capability. The catalog does not infer reasoning, coding, vision, or tool-use competence from a filename.
- Model outputs remain untrusted. APEX/Director authorization, East/e3 execution, ExploitGym isolation, BridgeGate origin authorization, RuntimeController lifecycle, and signed Evidence remain separate authority boundaries.
- The catalog does not alter runtime trust status or create a session. Native readiness remains dependent on the actual LlamaEngine/ModelPool session.

## Future work

- Parse GGUF metadata with the pinned native library and validate tensor architecture, tokenizer, context, and quantization.
- Add device-specific memory admission estimates using measured load peaks and KV-cache sizing.
- Add explicit model removal with confirmation, active-lease checks, and safe native unload.
- Introduce task-to-capability routing only after capabilities are grounded in verified metadata and runtime evaluation results.
- Keep model selection separate from execution authorization and runtime attestation.

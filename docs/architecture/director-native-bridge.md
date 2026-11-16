# Director/APEX native iOS bridge

## Restored source boundary

The original east-unified.zip archive contained the Director/APEX iOS bridge files BridgeGate.swift, RuntimeController.swift, LlamaEngine.swift, and Evidence.swift. The repository already had Evidence.swift; this change restores the missing bridge files as a Swift package at packages/director/ios.

The package depends on the shared runtime/ios PocketLlamaEngine package. It does not create a second inference engine or copy GGUF model bytes into a second in-memory slot.

## BridgeGate

- Uses the Web origin tuple: normalized scheme, host, and effective port.
- Rejects userinfo and non-HTTP(S) schemes.
- Permits cleartext HTTP only for loopback development; remote workspaces require HTTPS.
- Enforces action-specific required and allowed key sets; unknown fields fail closed.
- Validates session/request UUIDs, model identifiers, bounded prompt bytes, and challenge nonce length. Memory estimates and model hashes are resolved by the native host catalog, never supplied by WebKit.
- Requires host-owned authorization for model import, load, and unload. A boolean in a WebKit message cannot grant that authorization.
- The native Web Workspace now uses BridgeGate for top-level navigation policy and rejects credentialed workspace URLs. The WKScriptMessageHandler action dispatch is not yet connected; runtime-control messages remain unavailable until the host-owned approval coordinator is wired.

## RuntimeController

- Is an actor and owns exact ModelPool leases.
- Delegates all load/generation work to the shared NativeInferenceRuntime and its InferenceScheduler.
- Stores only session/metadata, never a full GGUF byte copy.
- Computes a streaming SHA-256 model-file hash before acquiring the runtime lease and again after load; both values must match the host catalog's expected hash and each other before the session is registered. The WebKit message carries only a model ID; the host resolves both the expected hash and memory estimate from the local catalog.
- Requires a real bounded one-token generation probe before reporting readiness; readiness expires.
- Checks the model file identity before readiness and generation. File changes invalidate readiness and fail closed.
- Tracks generation tasks, supports cancellation, and waits for the runtime cancellation-drain path before releasing a session.
- Returns an unsigned RuntimeGenerationRecord candidate with the caller's challenge nonce and generation-result hash. It does not accept a Director private key, sign evidence, issue receipts, or grant authorization.

deviceId and runtimeIdentity are descriptive runtime metadata in this package. They are not device attestation. A Director-side verifier and separately provisioned trusted signing key are required before any evidence can be accepted.

## Intentionally not restored as executable code

The original archive's ApexShell ShellView.swift created an ephemeral signing key in the UI process and passed it into RuntimeController, while the original RuntimeController accepted that key and signed generation records. It also instantiated an unavailable placeholder engine. That implementation is not copied into the app because it would create false trust and readiness claims. A future WebKit shell must use BridgeGate, host-owned approval state, the real shared runtime, and Director-side evidence verification.

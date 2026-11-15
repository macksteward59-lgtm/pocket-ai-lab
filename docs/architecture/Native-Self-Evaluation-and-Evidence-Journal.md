# Native self-evaluation and persistent evidence journal

## Purpose

Pocket AI Lab must evaluate a model by running benchmark cases through the native inference engine and the model session loaded by the app. A provider mock, cloud response, copied transcript, or externally supplied score is not a native execution result.

The initial iOS implementation adds:

- `NativeEvaluationRunner`: calls the injected `LlamaEngine.generate(session:request:)` for each case.
- `NativeEvaluationJournal`: persists every attempt, including failed and partial generations, in the app's Application Support directory.
- A SHA-256 fingerprint computed from the actual model file and checked immediately before and after generation.
- A newline-delimited, hash-chained journal. Reordering, editing, or removing an entry is detected during verification; writes fail closed if the on-disk chain changes.
- Separate append-only records for Critic assessments, Validator assessments, and model/agent challenges.
- Retry links and monotonically increasing attempt numbers per model fingerprint, suite, and case.

## Evidence semantics

A run is marked `nativeExecutionObserved` only when all of the following hold:

1. The injected provider is the app's concrete `LlamaCppMetalBackend`, not a test double or other provider.
2. A real `RuntimeSession` identifier is supplied and generation returns non-empty output without error.
3. The model artifact SHA-256 matches before and after inference.
4. The complete attempt is successfully appended to the local journal.

This flag is an observation of the concrete native provider path, **not a cryptographic attestation**. `runtimeTrustVerified` remains false. The journal does not issue signed Evidence, create receipts, approve actions, promote models, or authorize Director/APEX/East work.

Test doubles may exercise the runner and journal, but their attempts are labelled `unverifiedProvider` and can never set `nativeExecutionObserved`.

## Preservation model

- The journal stores the exact prompt, generated output (including partial output), failure detail, model ID and file hash, runtime session ID, suite/case version, timing, request ID, and retry relationship.
- A retry appends a new attempt; the original result is never updated or deleted.
- Critic and Validator assessments are separate events tied to an existing attempt. A review must use a different runtime session from the subject generation.
- Challenges append a separate event; they do not rewrite or erase a score.
- No application API for delete, truncate, overwrite, or automatic retention expiry is provided.
- The app stores the journal under Application Support and applies iOS file protection until the first device unlock. Normal device backup behavior is not disabled.

The hash chain is tamper-evident, not a hardware-backed signature. A privileged actor able to rewrite the entire file and recompute every hash could forge a new chain. Production-grade authenticity still requires the separately governed runtime proof/signature pipeline.

## Integration boundary and remaining work

This is the native app's execution and persistence foundation. It is not yet wired to a user-facing evaluation screen or the final ModelPool/catalog session-acquisition path. The caller must supply the active session and the corresponding model file URL. The next integration step is to connect this runner to the catalog-verified, ModelPool-leased session without bypassing memory admission or changing APEX/East trust semantics.

Hosted iOS CI can validate compilation and deterministic journal tests. It cannot prove that a physical iPhone has loaded a real GGUF model and completed a native evaluation. That acceptance test must run on the owner's device with a selected local model and retain the resulting journal entry.

# Native self-evaluation and persistent evidence journal

## Purpose

Pocket AI Lab must evaluate a model by running benchmark cases through the native inference engine and the model session loaded by the app. A provider mock, cloud response, copied transcript, or externally supplied score is not a native execution result.

The initial iOS implementation adds:

- `NativeEvaluationRunner`: calls `NativeInferenceRuntime.generateForEvaluation(lease:request:)` for each case using the exact active `ModelPoolLease` and the runtime's shared `InferenceScheduler`.
- `NativeEvaluationJournal`: persists every attempt, including failed and partial generations, in the app's Application Support directory.
- A SHA-256 fingerprint computed from the actual model file and checked immediately before and after generation.
- Versioned case criteria and expected outcomes retained with each attempt, plus an assessment schema for independent Critic/Validator reviews across eight capability dimensions: reasoning, factual accuracy, coding, task completion, collaboration, memory retention, security/policy compliance, and runtime efficiency/reliability.
- A newline-delimited, hash-chained journal. Editing, reordering, or deleting an interior entry is detected during verification; writes fail closed if the on-disk chain changes. Because this version has no external trusted checkpoint, deleting a suffix (including truncating the latest events) can leave a valid prefix and is not detectable after restart.
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

- The journal stores the exact prompt, generated output (including partial output), failure detail, model ID and file hash, runtime session ID, suite/case version, timing, request ID, retry relationship, prompt/output UTF-8 byte counts, and the ModelPool memory admission estimate (explicitly not measured resident memory).
- A retry appends a new attempt; the original result is never updated or deleted.
- **In-flight durability limit:** An attempt is appended only after `generateForEvaluation` returns. Partial output captured by the runtime is persisted when the runner returns with a partial or failed result. A hard app/process termination, OS kill, crash, or power loss during an active generation can lose that in-flight case and any tokens not yet appended. This version does not write a `started` event or periodic output checkpoints; append-only start/progress checkpoints are a future durability improvement, not a current guarantee.
- Four starter-suite cases use deterministic exact-match checks. The app reports an objective score only for those checks, deduplicating to the latest attempt per case. Reasoning, coding, collaboration, and security cases remain unscored pending independent Critic/Validator review; they are not silently counted as passes. The immediate recall case is not evidence of durable cross-session memory. The current UI does not yet launch separate Critic/Validator inference sessions automatically, so these four categories remain explicitly unscored.
- Critic and Validator assessments are separate events tied to an existing attempt. A review must use both a different evaluator model ID and a different runtime session from the subject generation. The subject model cannot grade itself and have that grade accepted as independent.
- Challenges append a separate event; they do not rewrite or erase a score.
- No application API for delete, truncate, overwrite, or automatic retention expiry is provided. This is an API-level constraint, not filesystem-enforced immutability; a privileged actor can still alter or truncate the file.
- The app stores the journal under Application Support and applies iOS file protection until the first device unlock. Normal device backup behavior is not disabled.

The app exposes a self-test action and a read-only history screen. Clearing conversation/Agent Team history does not clear the evaluation journal. The journal has no application delete/truncate API and no automatic retention expiry. This is device-local persistence; uninstalling the app or losing the device can still remove it. Application Support follows normal iOS device-backup behavior; the app does not currently provide a separate export or cross-device sync workflow.

The hash chain is local tamper evidence, not a hardware-backed signature or a complete anti-rollback mechanism. It detects edits, reordering, and interior deletion, but a valid-prefix suffix truncation cannot be detected after restart without an independently protected checkpoint; a privileged actor can also rewrite the entire file and recompute every hash. Production-grade authenticity and rollback resistance still require the separately governed runtime proof/signature pipeline.

## Score interpretation and limits

The current objective percentage is a narrow exact-match subset, not an overall intelligence score. The summary deduplicates retries by model fingerprint, suite version, and case ID, and uses only the latest attempt for each case. A failed, partial, or empty generation is a failed objective check. Four categories remain uncovered until a separate Critic/Validator runtime is integrated; they are not assigned zero, 100%, or an inferred grade.

The memory metric stored today is the ModelPool's configured admission estimate, not measured resident memory. Prompt/output sizes are UTF-8 byte counts, not tokenizer token counts. Latency is wall-clock elapsed time for the runner call. GPU utilization, thermal behavior, battery use, measured peak memory, token throughput, and persistent cross-session recall are not claimed by this initial suite.

## Integration boundary and remaining work

This is integrated into the native app through a self-test action and a read-only history screen. The runner requires the app's exact active ModelPool lease, calls the shared NativeInferenceRuntime evaluation path under its scheduler permit, and verifies that the lease model ID/path match the catalog content-addressed model file. It does not reach around the ModelPool or call LlamaEngine directly. The runtime derives its provider kind from the engine instance it owns; mocks and alternate providers are labelled unverified. A successful completed llama.cpp stream plus stable model-file fingerprint is required before the attempt is marked `nativeExecutionObserved`.

Hosted iOS CI can validate compilation, lease/scheduler behavior, partial-output retention, and deterministic journal tests. It cannot prove that a physical iPhone has loaded a real GGUF model and completed a native evaluation. That acceptance test must run on the owner's device with a selected local model and retain the resulting journal entry.

## Real-model runtime smoke coverage

The iOS LlamaEngine CI downloads the pinned smoke GGUF and verifies its exact byte count and SHA-256 before configuring the test path. The native runtime test then derives the catalog-style `sha256-<digest>` model ID from the file, acquires a real `ModelPoolLease` from `NativeInferenceRuntime`, and calls `generateForEvaluation` through that lease. It requires the runtime-owned provider to identify as llama.cpp, a completed non-empty response, unchanged model bytes, successful release of the exact lease, and successful unload with zero remaining reserved memory. This runs on the macOS CI host; it is not a physical iPhone execution or device acceptance result.

import Foundation
import XCTest
@testable import PocketLlamaEngine

final class NativeInputEmbeddingRuntimeTests: XCTestCase {
    func testCapabilitiesAndEvaluationUseTheLoadedEngineAndReleaseAdmission() async throws {
        let engine = ControlledInputEmbeddingTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("input-success"), estimatedMemoryMB: 128)
        let request = inputRequest(modelId: lease.model.id)

        let capabilities = try await runtime.inputEmbeddingCapabilities(lease: lease)
        XCTAssertEqual(capabilities, inputCapabilities(modelId: lease.model.id))
        let result = try await runtime.evaluateInputEmbeddings(lease: lease, request: request)
        XCTAssertEqual(result.requestId, request.requestId)
        XCTAssertEqual(result.modelId, lease.model.id)
        XCTAssertEqual(result.tokenCount, request.tokenCount)
        XCTAssertEqual(result.embeddingDimension, capabilities.inputDimension)
        XCTAssertEqual(result.logits, [0.25, -0.5, 0.75])
        XCTAssertEqual(runtime.providerKind, .other)

        let calls = await engine.snapshot()
        XCTAssertEqual(calls.capabilityCalls, 2)
        XCTAssertEqual(calls.evaluationRequestIDs, [request.requestId])
        XCTAssertEqual(calls.textCalls, 0)
        XCTAssertTrue(calls.drainRequestIDs.isEmpty)
        await assertIdle(runtime)
        try await releaseAndUnload(runtime, lease: lease)
    }

    func testTextOnlyEngineReportsUnavailableAndOrdinaryTextStillWorks() async throws {
        let engine = TextOnlyInputEmbeddingTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("text-only"), estimatedMemoryMB: 128)

        do {
            _ = try await runtime.inputEmbeddingCapabilities(lease: lease)
            XCTFail("A text-only engine must not advertise input embedding support")
        } catch NativeInferenceRuntimeError.inputEmbeddingUnavailable {
        }
        do {
            _ = try await runtime.evaluateInputEmbeddings(lease: lease, request: inputRequest(modelId: lease.model.id))
            XCTFail("A text-only engine must not silently reinterpret numerical inputs")
        } catch NativeInferenceRuntimeError.inputEmbeddingUnavailable {
        }

        let textCallsBefore = await engine.textCallCount()
        XCTAssertEqual(textCallsBefore, 0, "Unsupported input must not trigger hidden text fallback")
        let text = try await runtime.generate(
            lease: lease,
            request: GenerationRequest(prompt: "ordinary request", maxTokens: 8, temperature: 0)
        )
        XCTAssertEqual(text, "ordinary text")
        await assertIdle(runtime)
        try await releaseAndUnload(runtime, lease: lease)
    }

    func testMalformedRequestsAreRejectedBeforeBackendInspection() async throws {
        let engine = ControlledInputEmbeddingTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("model-caf\u{e9}"), estimatedMemoryMB: 128)
        let invalidRequests = [
            inputRequest(modelId: ""),
            inputRequest(modelId: "  \n"),
            inputRequest(modelId: "another-model"),
            inputRequest(modelId: "model-cafe\u{301}"),
            inputRequest(modelId: lease.model.id, tokenCount: 0, embeddings: []),
            inputRequest(modelId: lease.model.id, tokenCount: 257, embeddings: []),
            inputRequest(modelId: lease.model.id, tokenCount: Int.max, embeddingDimension: Int.max, embeddings: []),
            inputRequest(modelId: lease.model.id, embeddingDimension: 0, embeddings: []),
            inputRequest(modelId: lease.model.id, embeddingDimension: 8_193, embeddings: []),
            inputRequest(modelId: lease.model.id, embeddings: [0, 1, 2]),
            inputRequest(modelId: lease.model.id, embeddings: [0, 1, 2, 3, 4]),
            inputRequest(modelId: lease.model.id, embeddings: [0, 1, 2, .nan]),
            inputRequest(modelId: lease.model.id, embeddings: [0, 1, 2, .infinity]),
            inputRequest(modelId: lease.model.id, embeddings: [0, 1, 2, -.infinity])
        ]

        for request in invalidRequests {
            do {
                _ = try await runtime.evaluateInputEmbeddings(lease: lease, request: request)
                XCTFail("Malformed input must fail before inspecting or running the backend")
            } catch NativeInferenceRuntimeError.invalidInputEmbeddingRequest {
            }
        }

        let calls = await engine.snapshot()
        XCTAssertEqual(calls.capabilityCalls, 0)
        XCTAssertTrue(calls.evaluationRequestIDs.isEmpty)
        XCTAssertTrue(calls.drainRequestIDs.isEmpty)
        XCTAssertEqual(calls.textCalls, 0)
        await assertIdle(runtime)
        try await releaseAndUnload(runtime, lease: lease)
    }

    func testMalformedCapabilitiesAreRejectedBeforeEvaluation() async throws {
        let modelId = "model-caf\u{e9}"
        let invalidCapabilities = [
            inputCapabilities(modelId: "another-model"),
            inputCapabilities(modelId: "model-cafe\u{301}"),
            inputCapabilities(modelId: modelId, inputDimension: 0),
            inputCapabilities(modelId: modelId, inputDimension: 8_193),
            inputCapabilities(modelId: modelId, vocabularySize: 0),
            inputCapabilities(modelId: modelId, vocabularySize: 262_145),
            inputCapabilities(modelId: modelId, maxTokenCount: 0),
            inputCapabilities(modelId: modelId, maxTokenCount: 257),
            inputCapabilities(modelId: modelId, maxInputBytes: 0),
            inputCapabilities(modelId: modelId, maxInputBytes: 16 * 1024 * 1024 + 1),
            inputCapabilities(modelId: modelId, maxInputBytes: 4)
        ]

        for capabilities in invalidCapabilities {
            let engine = ControlledInputEmbeddingTestEngine(capabilitiesOverride: capabilities)
            let runtime = try makeRuntime(engine: engine)
            let lease = try await runtime.acquire(model: model(modelId), estimatedMemoryMB: 128)
            do {
                _ = try await runtime.inputEmbeddingCapabilities(lease: lease)
                XCTFail("Malformed capability metadata must not escape the runtime")
            } catch NativeInferenceRuntimeError.invalidInputEmbeddingCapabilities {
            }
            do {
                _ = try await runtime.evaluateInputEmbeddings(lease: lease, request: inputRequest(modelId: modelId))
                XCTFail("Malformed capability metadata must not authorize evaluation")
            } catch NativeInferenceRuntimeError.invalidInputEmbeddingCapabilities {
            }
            let calls = await engine.snapshot()
            XCTAssertEqual(calls.capabilityCalls, 2)
            XCTAssertTrue(calls.evaluationRequestIDs.isEmpty)
            XCTAssertTrue(calls.drainRequestIDs.isEmpty, "Capability inspection does not start an inference task")
            await assertIdle(runtime)
            try await releaseAndUnload(runtime, lease: lease)
        }
    }

    func testRequestMustFitLiveInputDimensionAndNegotiatedBounds() async throws {
        let modelId = "negotiated-input"
        let incompatibleCapabilities = [
            inputCapabilities(modelId: modelId, inputDimension: 3),
            inputCapabilities(modelId: modelId, maxTokenCount: 1),
            inputCapabilities(modelId: modelId, maxInputBytes: 8)
        ]
        for capabilities in incompatibleCapabilities {
            let engine = ControlledInputEmbeddingTestEngine(capabilitiesOverride: capabilities)
            let runtime = try makeRuntime(engine: engine)
            let lease = try await runtime.acquire(model: model(modelId), estimatedMemoryMB: 128)
            do {
                _ = try await runtime.evaluateInputEmbeddings(lease: lease, request: inputRequest(modelId: modelId))
                XCTFail("Input must fit the live model's dimension, row bound, and byte bound")
            } catch NativeInferenceRuntimeError.invalidInputEmbeddingRequest {
            }
            let calls = await engine.snapshot()
            XCTAssertEqual(calls.capabilityCalls, 1)
            XCTAssertTrue(calls.evaluationRequestIDs.isEmpty)
            XCTAssertTrue(calls.drainRequestIDs.isEmpty)
            await assertIdle(runtime)
            try await releaseAndUnload(runtime, lease: lease)
        }
    }

    func testInvalidResultMetadataAndLogitsAreRejectedAndDrained() async throws {
        for fault in InputEmbeddingResultFault.allCases {
            let engine = ControlledInputEmbeddingTestEngine(resultFault: fault)
            let runtime = try makeRuntime(engine: engine)
            let lease = try await runtime.acquire(model: model("model-caf\u{e9}"), estimatedMemoryMB: 128)
            let request = inputRequest(modelId: lease.model.id)
            do {
                _ = try await runtime.evaluateInputEmbeddings(lease: lease, request: request)
                XCTFail("Result metadata and finite bounded vocabulary logits must be validated: \(fault)")
            } catch NativeInferenceRuntimeError.invalidInputEmbeddingOutput {
            }
            let calls = await engine.snapshot()
            XCTAssertEqual(calls.evaluationRequestIDs, [request.requestId])
            XCTAssertEqual(calls.drainRequestIDs, [request.requestId.uuidString])
            XCTAssertEqual(calls.textCalls, 0)
            await assertIdle(runtime)
            try await releaseAndUnload(runtime, lease: lease)
        }
    }

    func testReleasedAndForeignLeasesCannotInspectOrEvaluate() async throws {
        let firstEngine = ControlledInputEmbeddingTestEngine()
        let secondEngine = ControlledInputEmbeddingTestEngine()
        let firstRuntime = try makeRuntime(engine: firstEngine)
        let secondRuntime = try makeRuntime(engine: secondEngine)
        let lease = try await firstRuntime.acquire(model: model("exact-lease"), estimatedMemoryMB: 128)
        let request = inputRequest(modelId: lease.model.id)
        for (index, runtime) in [secondRuntime, firstRuntime].enumerated() {
            if index == 1 {
                let released = await firstRuntime.release(lease)
                XCTAssertTrue(released)
            }
            do {
                _ = try await runtime.inputEmbeddingCapabilities(lease: lease)
                XCTFail("Only an exact active lease can inspect the loaded session")
            } catch ModelPoolError.invalidLease {
            }
            do {
                _ = try await runtime.evaluateInputEmbeddings(lease: lease, request: request)
                XCTFail("Only an exact active lease can evaluate inputs")
            } catch ModelPoolError.invalidLease {
            }
            await assertIdle(runtime)
        }
        let firstCalls = await firstEngine.snapshot()
        let secondCalls = await secondEngine.snapshot()
        XCTAssertEqual(firstCalls.capabilityCalls, 0)
        XCTAssertEqual(secondCalls.capabilityCalls, 0)
        XCTAssertTrue(firstCalls.evaluationRequestIDs.isEmpty)
        XCTAssertTrue(secondCalls.evaluationRequestIDs.isEmpty)
        try await firstRuntime.unload(modelId: lease.model.id)
    }

    func testLeaseModelAndSessionMustMatchByBytes() async throws {
        let engine = ControlledInputEmbeddingTestEngine(sessionModelIdOverride: "model-cafe\u{301}")
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("model-caf\u{e9}"), estimatedMemoryMB: 128)
        do {
            _ = try await runtime.inputEmbeddingCapabilities(lease: lease)
            XCTFail("Canonically equal model strings with different bytes must not identify this boundary")
        } catch NativeInferenceRuntimeError.invalidInputEmbeddingCapabilities {
        }
        do {
            _ = try await runtime.evaluateInputEmbeddings(lease: lease, request: inputRequest(modelId: lease.model.id))
            XCTFail("The request must match both the descriptor and the loaded session by bytes")
        } catch NativeInferenceRuntimeError.invalidInputEmbeddingRequest {
        }
        let calls = await engine.snapshot()
        XCTAssertEqual(calls.capabilityCalls, 0)
        XCTAssertTrue(calls.evaluationRequestIDs.isEmpty)
        await assertIdle(runtime)
        try await releaseAndUnload(runtime, lease: lease)
    }

    func testSchedulerSerializesInputEvaluationAndOrdinaryTextGeneration() async throws {
        let engine = ControlledInputEmbeddingTestEngine(automaticallyCompletes: false)
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("shared-admission"), estimatedMemoryMB: 128)
        let request = inputRequest(modelId: lease.model.id)
        let evaluation = Task { try await runtime.evaluateInputEmbeddings(lease: lease, request: request) }
        try await waitForInputEmbeddingCondition { (await engine.snapshot()).activeRequestIDs.contains(request.requestId) }

        let generation = Task {
            try await runtime.generate(
                lease: lease,
                request: GenerationRequest(prompt: "wait for numerical evaluation", maxTokens: 8, temperature: 0)
            )
        }
        try await waitForInputEmbeddingCondition { (await runtime.schedulerSnapshot()).waitingRequests == 1 }
        let during = await runtime.snapshot()
        let schedulerDuring = await runtime.schedulerSnapshot()
        let callsDuring = await engine.snapshot()
        XCTAssertEqual(during.activeUseCount, 2)
        XCTAssertEqual(schedulerDuring.activeRequests, 1)
        XCTAssertEqual(callsDuring.textCalls, 0)

        await engine.finish(request.requestId)
        _ = try await evaluation.value
        let text = try await generation.value
        XCTAssertEqual(text, "ordinary text")
        await assertIdle(runtime)
        try await releaseAndUnload(runtime, lease: lease)
    }

    func testQueuedEvaluationCancellationDoesNotReachEngineAndReleasesUsePin() async throws {
        let engine = ControlledInputEmbeddingTestEngine(automaticallyCompletes: false)
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("queued-input-cancel"), estimatedMemoryMB: 128)
        let firstRequest = inputRequest(modelId: lease.model.id)
        let queuedRequest = inputRequest(modelId: lease.model.id)
        let first = Task { try await runtime.evaluateInputEmbeddings(lease: lease, request: firstRequest) }
        try await waitForInputEmbeddingCondition { (await engine.snapshot()).activeRequestIDs.contains(firstRequest.requestId) }
        let queued = Task { try await runtime.evaluateInputEmbeddings(lease: lease, request: queuedRequest) }
        try await waitForInputEmbeddingCondition { (await runtime.schedulerSnapshot()).waitingRequests == 1 }

        queued.cancel()
        do {
            _ = try await queued.value
            XCTFail("A cancelled queued evaluation must not run")
        } catch is CancellationError {
        }
        let after = await runtime.snapshot()
        let schedulerAfter = await runtime.schedulerSnapshot()
        let calls = await engine.snapshot()
        XCTAssertEqual(after.activeUseCount, 1)
        XCTAssertEqual(schedulerAfter.activeRequests, 1)
        XCTAssertEqual(schedulerAfter.waitingRequests, 0)
        XCTAssertEqual(calls.capabilityCalls, 1)
        XCTAssertEqual(calls.evaluationRequestIDs, [firstRequest.requestId])
        XCTAssertTrue(calls.drainRequestIDs.isEmpty)

        await engine.finish(firstRequest.requestId)
        _ = try await first.value
        await assertIdle(runtime)
        try await releaseAndUnload(runtime, lease: lease)
    }

    func testQueuedCapabilityCancellationReleasesUsePinWithoutInspectingEngine() async throws {
        let engine = ControlledInputEmbeddingTestEngine(automaticallyCompletes: false)
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("queued-capability-cancel"), estimatedMemoryMB: 128)
        let request = inputRequest(modelId: lease.model.id)
        let evaluation = Task { try await runtime.evaluateInputEmbeddings(lease: lease, request: request) }
        try await waitForInputEmbeddingCondition { (await engine.snapshot()).activeRequestIDs.contains(request.requestId) }
        let query = Task { try await runtime.inputEmbeddingCapabilities(lease: lease) }
        try await waitForInputEmbeddingCondition { (await runtime.schedulerSnapshot()).waitingRequests == 1 }

        query.cancel()
        do {
            _ = try await query.value
            XCTFail("A cancelled queued capability query must not inspect a session")
        } catch is CancellationError {
        }
        let after = await runtime.snapshot()
        let schedulerAfter = await runtime.schedulerSnapshot()
        let calls = await engine.snapshot()
        XCTAssertEqual(after.activeUseCount, 1)
        XCTAssertEqual(schedulerAfter.activeRequests, 1)
        XCTAssertEqual(schedulerAfter.waitingRequests, 0)
        XCTAssertEqual(calls.capabilityCalls, 1)

        await engine.finish(request.requestId)
        _ = try await evaluation.value
        await assertIdle(runtime)
        try await releaseAndUnload(runtime, lease: lease)
    }

    func testInFlightCancellationKeepsLeaseAndPermitUntilDrainCompletes() async throws {
        let engine = ControlledInputEmbeddingTestEngine(automaticallyCompletes: false, blocksCancellationDrain: true)
        let runtime = try makeRuntime(engine: engine)
        let descriptor = model("input-cancel-drain")
        let request = inputRequest(modelId: descriptor.id)
        let operation = Task {
            try await runtime.withLease(model: descriptor, estimatedMemoryMB: 128) { lease in
                try await runtime.evaluateInputEmbeddings(lease: lease, request: request)
            }
        }
        try await waitForInputEmbeddingCondition { (await engine.snapshot()).activeRequestIDs.contains(request.requestId) }
        operation.cancel()
        try await waitForInputEmbeddingCondition { (await engine.snapshot()).blockedDrainRequestIDs.contains(request.requestId.uuidString) }

        let during = await runtime.snapshot()
        let schedulerDuring = await runtime.schedulerSnapshot()
        XCTAssertEqual(during.activeLeaseCount, 1)
        XCTAssertEqual(during.activeUseCount, 1)
        XCTAssertEqual(schedulerDuring.activeRequests, 1)

        await engine.completeCancellationDrain(request.requestId)
        do {
            _ = try await operation.value
            XCTFail("A cancelled input evaluation must not succeed")
        } catch is CancellationError {
        }
        let after = await runtime.snapshot()
        let calls = await engine.snapshot()
        XCTAssertEqual(after.activeLeaseCount, 0)
        XCTAssertEqual(calls.drainRequestIDs, [request.requestId.uuidString])
        XCTAssertEqual(calls.textCalls, 0)
        await assertIdle(runtime)
        try await runtime.unload(modelId: descriptor.id)
    }

    func testInvalidResultKeepsUsePinAndPermitUntilDrainCompletes() async throws {
        let engine = ControlledInputEmbeddingTestEngine(blocksCancellationDrain: true, resultFault: .requestId)
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("invalid-result-drain"), estimatedMemoryMB: 128)
        let request = inputRequest(modelId: lease.model.id)
        let operation = Task { try await runtime.evaluateInputEmbeddings(lease: lease, request: request) }
        try await waitForInputEmbeddingCondition { (await engine.snapshot()).blockedDrainRequestIDs.contains(request.requestId.uuidString) }

        let released = await runtime.release(lease)
        XCTAssertTrue(released)
        let during = await runtime.snapshot()
        let schedulerDuring = await runtime.schedulerSnapshot()
        XCTAssertEqual(during.activeLeaseCount, 0)
        XCTAssertEqual(during.activeUseCount, 1)
        XCTAssertEqual(schedulerDuring.activeRequests, 1)
        do {
            try await runtime.unload(modelId: lease.model.id)
            XCTFail("A result failure must pin the native session until cancellation drain returns")
        } catch ModelPoolError.activeUses(let modelId, let count) {
            XCTAssertEqual(modelId, lease.model.id)
            XCTAssertEqual(count, 1)
        }

        await engine.completeCancellationDrain(request.requestId)
        do {
            _ = try await operation.value
            XCTFail("A malformed result must fail after draining")
        } catch NativeInferenceRuntimeError.invalidInputEmbeddingOutput {
        }
        await assertIdle(runtime)
        try await runtime.unload(modelId: lease.model.id)
    }

    func testReleasedLeaseDoesNotUnpinSuccessfulInFlightEvaluation() async throws {
        let engine = ControlledInputEmbeddingTestEngine(automaticallyCompletes: false)
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("input-use-pin"), estimatedMemoryMB: 128)
        let request = inputRequest(modelId: lease.model.id)
        let operation = Task { try await runtime.evaluateInputEmbeddings(lease: lease, request: request) }
        try await waitForInputEmbeddingCondition { (await engine.snapshot()).activeRequestIDs.contains(request.requestId) }
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
        do {
            try await runtime.unload(modelId: lease.model.id)
            XCTFail("An active input evaluation must retain its own native use pin")
        } catch ModelPoolError.activeUses(let modelId, let count) {
            XCTAssertEqual(modelId, lease.model.id)
            XCTAssertEqual(count, 1)
        }

        await engine.finish(request.requestId)
        let result = try await operation.value
        XCTAssertEqual(result.requestId, request.requestId)
        await assertIdle(runtime)
        try await runtime.unload(modelId: lease.model.id)
        let afterUnload = await runtime.snapshot()
        XCTAssertEqual(afterUnload.reservedMemoryMB, 0)
    }

    func testLiveUnsupportedCapabilityReleasesUsePinWithoutTextFallback() async throws {
        let engine = ControlledInputEmbeddingTestEngine(capabilityError: .inputEmbeddingUnavailable)
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("unsupported-live-model"), estimatedMemoryMB: 128)
        do {
            _ = try await runtime.inputEmbeddingCapabilities(lease: lease)
            XCTFail("An unsupported loaded architecture must remain unavailable")
        } catch NativeInferenceRuntimeError.inputEmbeddingUnavailable {
        }
        do {
            _ = try await runtime.evaluateInputEmbeddings(lease: lease, request: inputRequest(modelId: lease.model.id))
            XCTFail("A protocol conformance must not override the actual loaded model's capability")
        } catch NativeInferenceRuntimeError.inputEmbeddingUnavailable {
        }
        let calls = await engine.snapshot()
        XCTAssertTrue(calls.evaluationRequestIDs.isEmpty)
        XCTAssertTrue(calls.drainRequestIDs.isEmpty)
        XCTAssertEqual(calls.textCalls, 0)
        await assertIdle(runtime)
        try await releaseAndUnload(runtime, lease: lease)
    }

    func testNativeFailureDrainsMatchingRequestAndDoesNotFallback() async throws {
        let engine = ControlledInputEmbeddingTestEngine(evaluationError: .backendFailed("fixture decode failure"))
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("failed-input-decode"), estimatedMemoryMB: 128)
        let request = inputRequest(modelId: lease.model.id)
        do {
            _ = try await runtime.evaluateInputEmbeddings(lease: lease, request: request)
            XCTFail("Native failures must propagate instead of starting a replacement inference")
        } catch LlamaEngineError.backendFailed(let message) {
            XCTAssertEqual(message, "fixture decode failure")
        }
        let calls = await engine.snapshot()
        XCTAssertEqual(calls.evaluationRequestIDs, [request.requestId])
        XCTAssertEqual(calls.drainRequestIDs, [request.requestId.uuidString])
        XCTAssertEqual(calls.textCalls, 0)
        await assertIdle(runtime)
        try await releaseAndUnload(runtime, lease: lease)
    }

    private func makeRuntime(engine: any LlamaEngine) throws -> NativeInferenceRuntime {
        try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: ModelPoolConfiguration(
                maxResidentMemoryMB: 1_024,
                maxLoadedModels: 1,
                minimumFreeMemoryMB: 128
            ),
            availableMemoryMB: { 2_048 },
            maxConcurrentRequests: 1
        )
    }

    private func model(_ id: String) -> ModelDescriptor {
        ModelDescriptor(id: id, name: id, path: "/tmp/\(id).gguf", contextLength: 512)
    }

    private func assertIdle(
        _ runtime: NativeInferenceRuntime,
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        let pool = await runtime.snapshot()
        let scheduler = await runtime.schedulerSnapshot()
        XCTAssertEqual(pool.activeUseCount, 0, file: file, line: line)
        XCTAssertEqual(scheduler.activeRequests, 0, file: file, line: line)
        XCTAssertEqual(scheduler.waitingRequests, 0, file: file, line: line)
    }

    private func releaseAndUnload(_ runtime: NativeInferenceRuntime, lease: ModelPoolLease) async throws {
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
        try await runtime.unload(modelId: lease.model.id)
    }
}

private func inputRequest(
    modelId: String,
    tokenCount: Int = 2,
    embeddingDimension: Int = 2,
    embeddings: [Float] = [0.1, 0.2, 0.3, 0.4]
) -> NativeInputEmbeddingRequest {
    NativeInputEmbeddingRequest(
        modelId: modelId,
        tokenCount: tokenCount,
        embeddingDimension: embeddingDimension,
        embeddings: embeddings
    )
}

private func inputCapabilities(
    modelId: String,
    inputDimension: Int = 2,
    vocabularySize: Int = 3,
    maxTokenCount: Int = 4,
    maxInputBytes: Int = 128
) -> NativeInputEmbeddingCapabilities {
    NativeInputEmbeddingCapabilities(
        modelId: modelId,
        inputDimension: inputDimension,
        vocabularySize: vocabularySize,
        maxTokenCount: maxTokenCount,
        maxInputBytes: maxInputBytes
    )
}

private enum InputEmbeddingResultFault: CaseIterable, Equatable, Sendable {
    case requestId
    case modelId
    case tokenCount
    case dimension
    case emptyLogits
    case vocabularySize
    case oversizedLogits
    case nonFiniteLogits
}

private struct InputEmbeddingTestEngineSnapshot: Sendable {
    let capabilityCalls: Int
    let evaluationRequestIDs: [UUID]
    let activeRequestIDs: Set<UUID>
    let textCalls: Int
    let drainRequestIDs: [String]
    let blockedDrainRequestIDs: Set<String>
}

private actor ControlledInputEmbeddingTestEngine: InputEmbeddingEvaluatingLlamaEngine {
    private let capabilitiesOverride: NativeInputEmbeddingCapabilities?
    private let sessionModelIdOverride: String?
    private let automaticallyCompletes: Bool
    private let blocksCancellationDrain: Bool
    private let resultFault: InputEmbeddingResultFault?
    private let capabilityError: NativeInferenceRuntimeError?
    private let evaluationError: LlamaEngineError?
    private var capabilityCalls = 0
    private var evaluationRequestIDs: [UUID] = []
    private var requests: [UUID: NativeInputEmbeddingRequest] = [:]
    private var continuations: [UUID: CheckedContinuation<NativeInputEmbeddingEvaluationResult, Error>] = [:]
    private var textCalls = 0
    private var drainRequestIDs: [String] = []
    private var drainContinuations: [String: CheckedContinuation<Void, Never>] = [:]

    init(
        capabilitiesOverride: NativeInputEmbeddingCapabilities? = nil,
        sessionModelIdOverride: String? = nil,
        automaticallyCompletes: Bool = true,
        blocksCancellationDrain: Bool = false,
        resultFault: InputEmbeddingResultFault? = nil,
        capabilityError: NativeInferenceRuntimeError? = nil,
        evaluationError: LlamaEngineError? = nil
    ) {
        self.capabilitiesOverride = capabilitiesOverride
        self.sessionModelIdOverride = sessionModelIdOverride
        self.automaticallyCompletes = automaticallyCompletes
        self.blocksCancellationDrain = blocksCancellationDrain
        self.resultFault = resultFault
        self.capabilityError = capabilityError
        self.evaluationError = evaluationError
    }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: "session-\(model.id)", modelId: sessionModelIdOverride ?? model.id)
    }

    func inputEmbeddingCapabilities(session: RuntimeSession) async throws -> NativeInputEmbeddingCapabilities {
        capabilityCalls += 1
        if let capabilityError { throw capabilityError }
        return capabilitiesOverride ?? inputCapabilities(modelId: session.modelId)
    }

    func evaluateInputEmbeddings(
        session: RuntimeSession,
        request: NativeInputEmbeddingRequest
    ) async throws -> NativeInputEmbeddingEvaluationResult {
        evaluationRequestIDs.append(request.requestId)
        if let evaluationError { throw evaluationError }
        if automaticallyCompletes { return result(for: request) }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                if Task.isCancelled {
                    continuation.resume(throwing: CancellationError())
                } else {
                    requests[request.requestId] = request
                    continuations[request.requestId] = continuation
                }
            }
        } onCancel: {
            Task { await self.finishWithCancellation(request.requestId) }
        }
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        textCalls += 1
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: "ordinary text", isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async {
        if let id = UUID(uuidString: requestId) { finishWithCancellation(id) }
    }

    func cancelAndWait(sessionId: String, requestId: String) async {
        drainRequestIDs.append(requestId)
        if let id = UUID(uuidString: requestId) { finishWithCancellation(id) }
        if blocksCancellationDrain {
            await withCheckedContinuation { continuation in
                drainContinuations[requestId] = continuation
            }
        }
    }

    func unload(sessionId: String) async {}

    func finish(_ requestId: UUID) {
        guard let continuation = continuations.removeValue(forKey: requestId),
              let request = requests.removeValue(forKey: requestId) else { return }
        continuation.resume(returning: result(for: request))
    }

    func finishWithCancellation(_ requestId: UUID) {
        requests.removeValue(forKey: requestId)
        continuations.removeValue(forKey: requestId)?.resume(throwing: CancellationError())
    }

    func completeCancellationDrain(_ requestId: UUID) {
        drainContinuations.removeValue(forKey: requestId.uuidString)?.resume()
    }

    func snapshot() -> InputEmbeddingTestEngineSnapshot {
        InputEmbeddingTestEngineSnapshot(
            capabilityCalls: capabilityCalls,
            evaluationRequestIDs: evaluationRequestIDs,
            activeRequestIDs: Set(continuations.keys),
            textCalls: textCalls,
            drainRequestIDs: drainRequestIDs,
            blockedDrainRequestIDs: Set(drainContinuations.keys)
        )
    }

    private func result(for request: NativeInputEmbeddingRequest) -> NativeInputEmbeddingEvaluationResult {
        let logits: [Float]
        switch resultFault {
        case .emptyLogits: logits = []
        case .vocabularySize: logits = [0, 1]
        case .oversizedLogits: logits = Array(repeating: 0, count: NativeInputEmbeddingLimits.maxLogitCount + 1)
        case .nonFiniteLogits: logits = [0, .nan, .infinity]
        default: logits = [0.25, -0.5, 0.75]
        }
        return NativeInputEmbeddingEvaluationResult(
            requestId: resultFault == .requestId ? UUID() : request.requestId,
            modelId: resultFault == .modelId ? "model-cafe\u{301}" : request.modelId,
            tokenCount: resultFault == .tokenCount ? request.tokenCount + 1 : request.tokenCount,
            embeddingDimension: resultFault == .dimension ? request.embeddingDimension + 1 : request.embeddingDimension,
            logits: logits
        )
    }
}

private actor TextOnlyInputEmbeddingTestEngine: LlamaEngine {
    private var textCalls = 0

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: "session-\(model.id)", modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        textCalls += 1
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: "ordinary text", isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
    func textCallCount() -> Int { textCalls }
}

private func waitForInputEmbeddingCondition(
    timeout: TimeInterval = 15,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ condition: () async -> Bool
) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while !(await condition()) {
        guard Date() < deadline else {
            XCTFail("Timed out waiting for input evaluation fixture state", file: file, line: line)
            throw InputEmbeddingTestWaitTimeout()
        }
        try await Task.sleep(nanoseconds: 10_000_000)
    }
}

private struct InputEmbeddingTestWaitTimeout: Error {}

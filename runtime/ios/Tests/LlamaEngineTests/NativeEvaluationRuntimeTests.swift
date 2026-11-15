import XCTest
@testable import PocketLlamaEngine

final class NativeEvaluationRuntimeTests: XCTestCase {
    func testPartialOutputIsRetainedAndCancellationDrainCompletesBeforeUsePinRelease() async throws {
        let engine = PartialFailureEvaluationEngine()
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("partial-evaluation"), estimatedMemoryMB: 128)
        let result = try await runtime.generateForEvaluation(
            lease: lease,
            request: GenerationRequest(prompt: "evaluate", maxTokens: 32, temperature: 0)
        )

        XCTAssertEqual(result.status, .partial)
        XCTAssertEqual(result.output, "partial answer")
        XCTAssertNotNil(result.errorMessage)
        let drainCount = await engine.drainCount()
        XCTAssertEqual(drainCount, 1)
        let pool = await runtime.snapshot()
        XCTAssertEqual(pool.activeUseCount, 0)
        let scheduler = await runtime.schedulerSnapshot()
        XCTAssertEqual(scheduler.activeRequests, 0)
        XCTAssertEqual(runtime.providerKind, .other)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
        try await runtime.unload(modelId: lease.model.id)
    }

    func testReleasedLeaseCannotCreateEvaluationEvidence() async throws {
        let engine = PartialFailureEvaluationEngine()
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("released-evaluation"), estimatedMemoryMB: 128)
        XCTAssertTrue(await runtime.release(lease))
        do {
            _ = try await runtime.generateForEvaluation(
                lease: lease,
                request: GenerationRequest(prompt: "must not run", maxTokens: 16, temperature: 0)
            )
            XCTFail("A released lease must be rejected")
        } catch ModelPoolError.invalidLease {
        }
        let drainCount = await engine.drainCount()
        XCTAssertEqual(drainCount, 0)
    }

    func testProviderIdentityComesFromTheRuntimeOwnedEngine() throws {
        let llamaRuntime = try NativeInferenceRuntime(
            engine: LlamaCppMetalBackend(requireMetal: true),
            poolConfiguration: ModelPoolConfiguration(maxResidentMemoryMB: 1024, maxLoadedModels: 1),
            availableMemoryMB: { 2048 }
        )
        let testRuntime = try makeRuntime(engine: PartialFailureEvaluationEngine())
        XCTAssertEqual(llamaRuntime.providerKind, .llamaCpp)
        XCTAssertEqual(testRuntime.providerKind, .other)
    }

    private func makeRuntime(engine: PartialFailureEvaluationEngine) throws -> NativeInferenceRuntime {
        try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: ModelPoolConfiguration(
                maxResidentMemoryMB: 1024,
                maxLoadedModels: 1,
                minimumFreeMemoryMB: 128
            ),
            availableMemoryMB: { 2048 },
            maxConcurrentRequests: 1
        )
    }

    private func model(_ id: String) -> ModelDescriptor {
        ModelDescriptor(id: id, name: id, path: "/tmp/\(id).gguf", contextLength: 512)
    }
}

private actor PartialFailureEvaluationEngine: LlamaEngine {
    private var drains = 0

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: "session-\(model.id)", modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(Token(text: "partial answer", isComplete: false))
            continuation.finish(throwing: LlamaEngineError.backendFailed("synthetic stream failure"))
        }
    }

    func cancel(sessionId: String, requestId: String) async {}

    func cancelAndWait(sessionId: String, requestId: String) async {
        drains += 1
    }

    func unload(sessionId: String) async {}

    func drainCount() -> Int { drains }
}

import XCTest
@testable import PocketLlamaEngine

final class NativeInferenceRuntimeTests: XCTestCase {
    func testSchedulerPermitCoversTheEntireGenerationStream() async throws {
        let engine = ControlledRuntimeTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let session = RuntimeSession(id: "session", modelId: "model")
        let firstRequest = GenerationRequest(prompt: "first", maxTokens: 16, temperature: 0)
        let secondRequest = GenerationRequest(prompt: "second", maxTokens: 16, temperature: 0)

        let first = Task {
            try await runtime.generate(session: session, request: firstRequest)
        }
        while !(await engine.activeRequestIDs()).contains(firstRequest.requestId) {
            await Task.yield()
        }

        let second = Task {
            try await runtime.generate(session: session, request: secondRequest)
        }
        while (await runtime.schedulerSnapshot()).waitingRequests == 0 {
            await Task.yield()
        }

        let duringFirst = await runtime.schedulerSnapshot()
        XCTAssertEqual(duringFirst.activeRequests, 1)
        XCTAssertEqual(duringFirst.waitingRequests, 1)

        await engine.finish(firstRequest.requestId)
        let firstResult = try await first.value
        XCTAssertEqual(firstResult, "first result")
        while !(await engine.activeRequestIDs()).contains(secondRequest.requestId) {
            await Task.yield()
        }
        await engine.finish(secondRequest.requestId)
        let secondResult = try await second.value
        XCTAssertEqual(secondResult, "second result")

        let final = await runtime.schedulerSnapshot()
        XCTAssertEqual(final.activeRequests, 0)
        XCTAssertEqual(final.waitingRequests, 0)
    }

    func testLeaseRemainsActiveUntilCancellationDrainReturns() async throws {
        let engine = ControlledRuntimeTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let descriptor = model("cancel-drain")
        let request = GenerationRequest(prompt: "cancel me", maxTokens: 16, temperature: 0)

        let operation = Task {
            try await runtime.withLease(model: descriptor, estimatedMemoryMB: 256) { lease in
                try await runtime.generate(session: lease.session, request: request)
            }
        }

        while !(await engine.activeRequestIDs()).contains(request.requestId) {
            await Task.yield()
        }
        await engine.finishWithCancellation(request.requestId)
        while !(await engine.isCancellationDrainBlocked()) {
            await Task.yield()
        }

        let whileDraining = await runtime.snapshot()
        XCTAssertEqual(whileDraining.activeLeaseCount, 1)
        let schedulerWhileDraining = await runtime.schedulerSnapshot()
        XCTAssertEqual(schedulerWhileDraining.activeRequests, 1)

        await engine.completeCancellationDrain()
        do {
            _ = try await operation.value
            XCTFail("A cancelled generation must not return a successful result")
        } catch is CancellationError {
        }

        let afterDrain = await runtime.snapshot()
        XCTAssertEqual(afterDrain.activeLeaseCount, 0)
        XCTAssertEqual(afterDrain.reservedMemoryMB, 256)
        let finalScheduler = await runtime.schedulerSnapshot()
        XCTAssertEqual(finalScheduler.activeRequests, 0)
    }

    func testWithLeaseReleasesAfterSuccessfulOperation() async throws {
        let engine = ControlledRuntimeTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let descriptor = model("successful-lease")

        let operation = Task {
            try await runtime.withLease(model: descriptor, estimatedMemoryMB: 128) { lease in
                XCTAssertEqual(lease.session.modelId, descriptor.id)
                return "completed"
            }
        }
        let operationResult = try await operation.value
        XCTAssertEqual(operationResult, "completed")

        let snapshot = await runtime.snapshot()
        XCTAssertEqual(snapshot.activeLeaseCount, 0)
        XCTAssertEqual(snapshot.loadedModelIDs, [descriptor.id])
        XCTAssertEqual(snapshot.reservedMemoryMB, 128)
    }

    private func makeRuntime(engine: ControlledRuntimeTestEngine) throws -> NativeInferenceRuntime {
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
}

private actor ControlledRuntimeTestEngine: LlamaEngine {
    private var continuations: [String: AsyncThrowingStream<Token, Error>.Continuation] = [:]
    private var responseText: [String: String] = [:]
    private var cancellationDrainContinuation: CheckedContinuation<Void, Never>?
    private var cancellationDrainBlocked = false

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: "session-\(model.id)", modelId: model.id)
    }

    func generate(
        session: RuntimeSession,
        request: GenerationRequest
    ) async throws -> AsyncThrowingStream<Token, Error> {
        AsyncThrowingStream { continuation in
            Task { await self.register(request.requestId, response: request.prompt + " result", continuation: continuation) }
        }
    }

    func cancel(sessionId: String, requestId: String) async {}
    
    func cancelAndWait(sessionId: String, requestId: String) async {
        cancellationDrainBlocked = true
        await withCheckedContinuation { cancellationDrainContinuation = $0 }
        cancellationDrainBlocked = false
    }

    func unload(sessionId: String) async {}

    func register(
        _ requestId: String,
        response: String,
        continuation: AsyncThrowingStream<Token, Error>.Continuation
    ) {
        continuations[requestId] = continuation
        responseText[requestId] = response
    }

    func activeRequestIDs() -> [String] {
        Array(continuations.keys)
    }

    func finish(_ requestId: String) {
        guard let continuation = continuations.removeValue(forKey: requestId) else { return }
        continuation.yield(Token(text: responseText.removeValue(forKey: requestId) ?? "", isComplete: true))
        continuation.finish()
    }

    func finishWithCancellation(_ requestId: String) {
        guard let continuation = continuations.removeValue(forKey: requestId) else { return }
        responseText[requestId] = nil
        continuation.finish(throwing: CancellationError())
    }

    func isCancellationDrainBlocked() -> Bool {
        cancellationDrainBlocked
    }

    func completeCancellationDrain() {
        cancellationDrainContinuation?.resume()
        cancellationDrainContinuation = nil
    }
}

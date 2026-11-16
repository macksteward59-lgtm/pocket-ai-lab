import XCTest
@testable import PocketLlamaEngine

final class NativeInferenceRuntimeTests: XCTestCase {
    func testSchedulerPermitCoversTheEntireGenerationStream() async throws {
        let engine = ControlledRuntimeTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("model"), estimatedMemoryMB: 128)
        let firstRequest = GenerationRequest(prompt: "first", maxTokens: 16, temperature: 0)
        let secondRequest = GenerationRequest(prompt: "second", maxTokens: 16, temperature: 0)

        let first = Task {
            try await runtime.generate(lease: lease, request: firstRequest)
        }
        while !(await engine.activeRequestIDs()).contains(firstRequest.requestId) {
            await Task.yield()
        }

        let second = Task {
            try await runtime.generate(lease: lease, request: secondRequest)
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
        let finalPool = await runtime.snapshot()
        XCTAssertEqual(finalPool.activeUseCount, 0)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
        try await runtime.unload(modelId: lease.model.id)
    }

    func testLeaseRemainsActiveUntilCancellationDrainReturns() async throws {
        let engine = ControlledRuntimeTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let descriptor = model("cancel-drain")
        let request = GenerationRequest(prompt: "cancel me", maxTokens: 16, temperature: 0)

        let operation = Task {
            try await runtime.withLease(model: descriptor, estimatedMemoryMB: 256) { lease in
                try await runtime.generate(lease: lease, request: request)
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
        XCTAssertEqual(whileDraining.activeUseCount, 1)
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


    func testCancelledQueuedGenerationReleasesItsUsePin() async throws {
        let engine = ControlledRuntimeTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("queued-cancel"), estimatedMemoryMB: 128)
        let firstRequest = GenerationRequest(prompt: "first", maxTokens: 16, temperature: 0)
        let queuedRequest = GenerationRequest(prompt: "queued", maxTokens: 16, temperature: 0)

        let first = Task {
            try await runtime.generate(lease: lease, request: firstRequest)
        }
        while !(await engine.activeRequestIDs()).contains(firstRequest.requestId) {
            await Task.yield()
        }

        let queued = Task {
            try await runtime.generate(lease: lease, request: queuedRequest)
        }
        while (await runtime.schedulerSnapshot()).waitingRequests == 0 {
            await Task.yield()
        }

        let queuedSnapshot = await runtime.snapshot()
        XCTAssertEqual(queuedSnapshot.activeUseCount, 2)
        let schedulerQueued = await runtime.schedulerSnapshot()
        XCTAssertEqual(schedulerQueued.activeRequests, 1)
        XCTAssertEqual(schedulerQueued.waitingRequests, 1)

        queued.cancel()
        do {
            _ = try await queued.value
            XCTFail("A cancelled queued generation must not run")
        } catch is CancellationError {
        }

        let afterCancel = await runtime.snapshot()
        XCTAssertEqual(afterCancel.activeUseCount, 1)
        let schedulerAfterCancel = await runtime.schedulerSnapshot()
        XCTAssertEqual(schedulerAfterCancel.activeRequests, 1)
        XCTAssertEqual(schedulerAfterCancel.waitingRequests, 0)
        let activeIDs = await engine.activeRequestIDs()
        XCTAssertEqual(activeIDs, [firstRequest.requestId])

        await engine.finish(firstRequest.requestId)
        _ = try await first.value
        let final = await runtime.snapshot()
        XCTAssertEqual(final.activeUseCount, 0)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
        try await runtime.unload(modelId: lease.model.id)
    }

    func testOutputLimitFailureKeepsUsePinUntilCancellationDrainCompletes() async throws {
        let engine = ControlledRuntimeTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("output-limit"), estimatedMemoryMB: 128)
        let request = GenerationRequest(prompt: "large output", maxTokens: 16, temperature: 0)
        let generation = Task {
            try await runtime.generate(lease: lease, request: request, maxOutputBytes: 1)
        }

        while !(await engine.activeRequestIDs()).contains(request.requestId) {
            await Task.yield()
        }
        await engine.finish(request.requestId)
        while !(await engine.isCancellationDrainBlocked()) {
            await Task.yield()
        }

        let whileDraining = await runtime.snapshot()
        XCTAssertEqual(whileDraining.activeUseCount, 1)
        let schedulerWhileDraining = await runtime.schedulerSnapshot()
        XCTAssertEqual(schedulerWhileDraining.activeRequests, 1)

        await engine.completeCancellationDrain()
        do {
            _ = try await generation.value
            XCTFail("An output-limit violation must fail generation")
        } catch NativeInferenceRuntimeError.responseTooLarge {
        }

        let afterDrain = await runtime.snapshot()
        XCTAssertEqual(afterDrain.activeUseCount, 0)
        let schedulerAfterDrain = await runtime.schedulerSnapshot()
        XCTAssertEqual(schedulerAfterDrain.activeRequests, 0)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
        try await runtime.unload(modelId: lease.model.id)
    }

    func testReleasedLeaseCannotStartGeneration() async throws {
        let engine = ControlledRuntimeTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("released"), estimatedMemoryMB: 128)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
        do {
            _ = try await runtime.generate(lease: lease, request: GenerationRequest(prompt: "must not run", maxTokens: 16, temperature: 0))
            XCTFail("A released lease must not authorize generation")
        } catch ModelPoolError.invalidLease {
        }
        let activeIDs = await engine.activeRequestIDs()
        XCTAssertTrue(activeIDs.isEmpty)
        let snapshot = await runtime.snapshot()
        XCTAssertEqual(snapshot.activeUseCount, 0)
    }

    func testActiveGenerationPinsSessionAfterLeaseReleaseUntilDrainCompletes() async throws {
        let engine = ControlledRuntimeTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: model("pinned"), estimatedMemoryMB: 128)
        let request = GenerationRequest(prompt: "pin session", maxTokens: 16, temperature: 0)
        let generation = Task { try await runtime.generate(lease: lease, request: request) }
        try await waitForTestCondition { !((await engine.activeRequestIDs()).contains(request.requestId)) }
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
        let during = await runtime.snapshot()
        XCTAssertEqual(during.activeUseCount, 1)
        do {
            try await runtime.unload(modelId: lease.model.id)
            XCTFail("An in-flight generation must pin the session after lease release")
        } catch ModelPoolError.activeUses(let modelId, let count) {
            XCTAssertEqual(modelId, lease.model.id)
            XCTAssertEqual(count, 1)
        }
        await engine.finish(request.requestId)
        _ = try await generation.value
        let after = await runtime.snapshot()
        XCTAssertEqual(after.activeUseCount, 0)
        try await runtime.unload(modelId: lease.model.id)
        let unloaded = await runtime.snapshot()
        XCTAssertEqual(unloaded.reservedMemoryMB, 0)
    }

    func testForeignRuntimeCannotUseAnotherPoolsLease() async throws {
        let firstEngine = ControlledRuntimeTestEngine()
        let secondEngine = ControlledRuntimeTestEngine()
        let firstRuntime = try makeRuntime(engine: firstEngine)
        let secondRuntime = try makeRuntime(engine: secondEngine)
        let lease = try await firstRuntime.acquire(model: model("foreign"), estimatedMemoryMB: 128)
        do {
            _ = try await secondRuntime.generate(lease: lease, request: GenerationRequest(prompt: "must not run", maxTokens: 16, temperature: 0))
            XCTFail("A lease from another pool must be rejected")
        } catch ModelPoolError.invalidLease {
        }
        let activeIDs = await secondEngine.activeRequestIDs()
        XCTAssertTrue(activeIDs.isEmpty)
        let released = await firstRuntime.release(lease)
        XCTAssertTrue(released)
        try await firstRuntime.unload(modelId: lease.model.id)
    }

    func testWithLeaseReleasesAfterSuccessfulOperation() async throws {
        let engine = ControlledRuntimeTestEngine()
        let runtime = try makeRuntime(engine: engine)
        let descriptor = model("successful-lease")

        let operation = Task {
            try await runtime.withLease(model: descriptor, estimatedMemoryMB: 128) { lease in
                return lease.session.modelId
            }
        }
        let operationResult = try await operation.value
        XCTAssertEqual(operationResult, descriptor.id)

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

/// Bounds asynchronous fixture polling so a broken actor handshake fails with a
/// useful XCTest failure instead of leaving the hosted simulator job spinning.
private func waitForTestCondition(
    timeout: TimeInterval = 15,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ condition: () async -> Bool
) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while await condition() {
        guard Date() < deadline else {
            XCTFail("Timed out waiting for asynchronous test condition", file: file, line: line)
            throw TestWaitTimeout()
        }
        try await Task.sleep(nanoseconds: 10_000_000)
    }
}

private struct TestWaitTimeout: Error {}

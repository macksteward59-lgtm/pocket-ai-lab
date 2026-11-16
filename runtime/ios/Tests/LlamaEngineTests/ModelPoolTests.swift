import XCTest
@testable import PocketLlamaEngine

final class ModelPoolTests: XCTestCase {
    func testMultipleLeasesShareOneSessionAndPreventPrematureUnload() async throws {
        let engine = PoolTestEngine()
        let pool = try makePool(engine: engine, maxMemory: 2_048, maxModels: 2)
        let descriptor = model("alpha")

        let first = try await pool.acquire(model: descriptor, estimatedMemoryMB: 512)
        let second = try await pool.acquire(model: descriptor, estimatedMemoryMB: 512)
        XCTAssertEqual(first.session, second.session)

        let snapshot = await pool.snapshot()
        XCTAssertEqual(snapshot.loadedModelIDs, ["alpha"])
        XCTAssertEqual(snapshot.activeLeaseCount, 2)
        XCTAssertEqual(snapshot.reservedMemoryMB, 512)

        do {
            try await pool.unload(modelId: "alpha")
            XCTFail("A model with active leases must not unload")
        } catch ModelPoolError.activeLeases(let modelId, let count) {
            XCTAssertEqual(modelId, "alpha")
            XCTAssertEqual(count, 2)
        }

        let firstReleased = await pool.release(first)
        XCTAssertTrue(firstReleased)
        let duplicateRelease = await pool.release(first)
        XCTAssertFalse(duplicateRelease)
        let secondReleased = await pool.release(second)
        XCTAssertTrue(secondReleased)
        try await pool.unload(modelId: "alpha")

        let unloaded = await engine.unloadedSessionIDs()
        XCTAssertEqual(unloaded, [first.session.id])
        let after = await pool.snapshot()
        XCTAssertEqual(after.reservedMemoryMB, 0)
        XCTAssertTrue(after.loadedModelIDs.isEmpty)
    }

    func testMemoryBudgetAndModelCountAreEnforcedBeforeLoading() async throws {
        let engine = PoolTestEngine()
        let configuration = try ModelPoolConfiguration(maxResidentMemoryMB: 512, maxLoadedModels: 1, minimumFreeMemoryMB: 64)
        let pool = ModelPool(engine: engine, configuration: configuration, availableMemoryMB: { 512 })

        do {
            _ = try await pool.acquire(model: model("too-large"), estimatedMemoryMB: 480)
            XCTFail("Insufficient free memory should reject the load")
        } catch ModelPoolError.insufficientMemory(let required, let available) {
            XCTAssertEqual(required, 480)
            XCTAssertEqual(available, 448)
        }

        let lease = try await pool.acquire(model: model("fits"), estimatedMemoryMB: 400)
        do {
            _ = try await pool.acquire(model: model("second"), estimatedMemoryMB: 50)
            XCTFail("Loaded-model limit should reject a second model")
        } catch ModelPoolError.modelLimitExceeded {
        }
        let leaseReleased = await pool.release(lease)
        XCTAssertTrue(leaseReleased)
        try await pool.unload(modelId: "fits")
        let calls = await engine.loadCallCount()
        XCTAssertEqual(calls, 1)
    }

    func testConflictingDescriptorForSameModelIdIsRejected() async throws {
        let engine = PoolTestEngine()
        let pool = try makePool(engine: engine)
        let original = model("same")
        let lease = try await pool.acquire(model: original, estimatedMemoryMB: 256)
        let conflicting = ModelDescriptor(
            id: "same", name: "same", path: "/tmp/different.gguf",
            contextLength: 512, quantization: "Q4_K_M"
        )
        do {
            _ = try await pool.acquire(model: conflicting, estimatedMemoryMB: 256)
            XCTFail("The same ID cannot silently refer to a different artifact")
        } catch ModelPoolError.descriptorConflict("same") {
        }
        let released = await pool.release(lease)
        XCTAssertTrue(released)
        try await pool.unload(modelId: "same")
    }

    func testFailedLoadReleasesPendingReservationAndCanRetry() async throws {
        let engine = PoolTestEngine(failFirstLoad: true)
        let pool = try makePool(engine: engine)
        do {
            _ = try await pool.acquire(model: model("retry"), estimatedMemoryMB: 300)
            XCTFail("The configured first load should fail")
        } catch LlamaEngineError.backendFailed {
        }

        let failedSnapshot = await pool.snapshot()
        XCTAssertTrue(failedSnapshot.pendingModelIDs.isEmpty)
        XCTAssertTrue(failedSnapshot.loadedModelIDs.isEmpty)
        XCTAssertEqual(failedSnapshot.reservedMemoryMB, 0)

        let lease = try await pool.acquire(model: model("retry"), estimatedMemoryMB: 300)
        XCTAssertEqual(lease.session.modelId, "retry")
        let released = await pool.release(lease)
        XCTAssertTrue(released)
        try await pool.unload(modelId: "retry")
        let calls = await engine.loadCallCount()
        XCTAssertEqual(calls, 2)
    }

    func testConcurrentAcquiresCoalesceIntoOneNativeLoad() async throws {
        let engine = BlockingPoolTestEngine()
        let pool = try makePool(engine: engine, maxMemory: 2_048, maxModels: 2)
        let descriptor = model("shared")

        let firstTask = Task {
            try await pool.acquire(model: descriptor, estimatedMemoryMB: 512)
        }
        try await waitForTestCondition { await engine.loadCallCount() == 0 }

        let secondTask = Task {
            try await pool.acquire(model: descriptor, estimatedMemoryMB: 512)
        }
        try await waitForTestCondition { (await pool.snapshot()).pendingAcquirerCount < 2 }
        await engine.finishLoad()

        let first = try await firstTask.value
        let second = try await secondTask.value
        XCTAssertEqual(first.session, second.session)
        let calls = await engine.loadCallCount()
        XCTAssertEqual(calls, 1)

        let firstReleased = await pool.release(first)
        let secondReleased = await pool.release(second)
        XCTAssertTrue(firstReleased)
        XCTAssertTrue(secondReleased)
        try await pool.unload(modelId: "shared")
    }

    func testCancellingOneCoalescedAcquirerDoesNotCancelAnotherWaiter() async throws {
        let engine = BlockingPoolTestEngine()
        let pool = try makePool(engine: engine, maxMemory: 2_048, maxModels: 2)
        let descriptor = model("shared")

        let cancelledTask = Task {
            try await pool.acquire(model: descriptor, estimatedMemoryMB: 512)
        }
        try await waitForTestCondition { await engine.loadCallCount() == 0 }

        let survivingTask = Task {
            try await pool.acquire(model: descriptor, estimatedMemoryMB: 512)
        }
        try await waitForTestCondition { (await pool.snapshot()).pendingAcquirerCount < 2 }

        // Cancellation belongs to the waiting caller, not the shared native
        // load. The second caller must still receive the completed session.
        cancelledTask.cancel()
        await engine.finishLoad()

        do {
            _ = try await cancelledTask.value
            XCTFail("The cancelled caller must not retain a lease")
        } catch is CancellationError {
        }

        let survivingLease = try await survivingTask.value
        XCTAssertEqual(survivingLease.session.modelId, "shared")
        let snapshot = await pool.snapshot()
        XCTAssertEqual(snapshot.loadedModelIDs, ["shared"])
        XCTAssertEqual(snapshot.activeLeaseCount, 1)
        XCTAssertEqual(snapshot.reservedMemoryMB, 512)
        let loadCalls = await engine.loadCallCount()
        XCTAssertEqual(loadCalls, 1)

        let released = await pool.release(survivingLease)
        XCTAssertTrue(released)
        try await pool.unload(modelId: "shared")
    }

    func testUnloadIdleModelsLeavesActivelyLeasedSessionsAlone() async throws {
        let engine = PoolTestEngine()
        let pool = try makePool(engine: engine, maxMemory: 2_048, maxModels: 2)
        let idle = try await pool.acquire(model: model("idle"), estimatedMemoryMB: 256)
        let active = try await pool.acquire(model: model("active"), estimatedMemoryMB: 256)
        let idleReleased = await pool.release(idle)
        XCTAssertTrue(idleReleased)

        let unloaded = await pool.unloadIdleModels()
        XCTAssertEqual(unloaded, ["idle"])
        let snapshot = await pool.snapshot()
        XCTAssertEqual(snapshot.loadedModelIDs, ["active"])
        XCTAssertEqual(snapshot.activeLeaseCount, 1)

        let activeReleased = await pool.release(active)
        XCTAssertTrue(activeReleased)
        let remaining = await pool.unloadIdleModels()
        XCTAssertEqual(remaining, ["active"])
        let final = await pool.snapshot()
        XCTAssertEqual(final.reservedMemoryMB, 0)
    }

    func testWrongModelSessionIsUnloadedAndReservationIsReleased() async throws {
        let engine = WrongModelPoolTestEngine()
        let pool = try makePool(engine: engine)
        do {
            _ = try await pool.acquire(model: model("requested"), estimatedMemoryMB: 256)
            XCTFail("A session for a different model must be rejected")
        } catch ModelPoolError.runtimeReturnedWrongModel(let expected, let actual) {
            XCTAssertEqual(expected, "requested")
            XCTAssertEqual(actual, "unexpected")
        }
        let snapshot = await pool.snapshot()
        XCTAssertEqual(snapshot.reservedMemoryMB, 0)
        XCTAssertTrue(snapshot.pendingModelIDs.isEmpty)
        let unloaded = await engine.unloadedSessionIDs()
        XCTAssertEqual(unloaded, ["wrong-session"])
    }

    func testSessionIdCollisionNeverUnloadsAnExistingOwnedSession() async throws {
        let engine = FixedSessionPoolTestEngine()
        let pool = try makePool(engine: engine, maxMemory: 2_048, maxModels: 2)
        let first = try await pool.acquire(model: model("first"), estimatedMemoryMB: 256)
        do {
            _ = try await pool.acquire(model: model("second"), estimatedMemoryMB: 256)
            XCTFail("A duplicate runtime session ID must be rejected")
        } catch ModelPoolError.runtimeSessionCollision("fixed-session") {
        }
        let unloadedBeforeRelease = await engine.unloadedSessionIDs()
        XCTAssertTrue(unloadedBeforeRelease.isEmpty)
        let snapshot = await pool.snapshot()
        XCTAssertEqual(snapshot.loadedModelIDs, ["first"])
        XCTAssertEqual(snapshot.reservedMemoryMB, 256)
        let released = await pool.release(first)
        XCTAssertTrue(released)
        try await pool.unload(modelId: "first")
        let unloadedAfter = await engine.unloadedSessionIDs()
        XCTAssertEqual(unloadedAfter, ["fixed-session"])
    }

    func testInvalidConfigurationAndResourceSnapshotAreRejected() async throws {
        XCTAssertThrowsError(try ModelPoolConfiguration(maxResidentMemoryMB: 0, maxLoadedModels: 1))
        let engine = PoolTestEngine()
        let configuration = try ModelPoolConfiguration(maxResidentMemoryMB: 1_024, maxLoadedModels: 1)
        let pool = ModelPool(engine: engine, configuration: configuration, availableMemoryMB: { -1 })
        let descriptor = model("invalid-memory")
        let leaseTask = Task { try await pool.acquire(model: descriptor, estimatedMemoryMB: 128) }
        do {
            _ = try await leaseTask.value
            XCTFail("Negative system memory must fail closed")
        } catch ModelPoolError.invalidResourceSnapshot {
        }
    }

    func testMemoryReservationRemainsHeldUntilNativeUnloadCompletes() async throws {
        let engine = BlockingUnloadPoolTestEngine()
        let configuration = try ModelPoolConfiguration(
            maxResidentMemoryMB: 512,
            maxLoadedModels: 2,
            minimumFreeMemoryMB: 64
        )
        let pool = ModelPool(engine: engine, configuration: configuration, availableMemoryMB: { 512 })
        let first = try await pool.acquire(model: model("unloading"), estimatedMemoryMB: 400)
        let firstReleased = await pool.release(first)
        XCTAssertTrue(firstReleased)

        let unloadTask = Task { try await pool.unload(modelId: "unloading") }
        try await waitForTestCondition { !((await engine.hasStartedUnloading())) }

        let duringUnload = await pool.snapshot()
        XCTAssertEqual(duringUnload.loadedModelIDs, [])
        XCTAssertEqual(duringUnload.unloadingModelIDs, ["unloading"])
        XCTAssertEqual(duringUnload.reservedMemoryMB, 400)
        do {
            _ = try await pool.acquire(model: model("second"), estimatedMemoryMB: 200)
            XCTFail("The old model's memory reservation must remain until unload returns")
        } catch ModelPoolError.insufficientMemory(let required, let available) {
            XCTAssertEqual(required, 200)
            XCTAssertEqual(available, 112)
        }

        await engine.finishUnloading()
        try await unloadTask.value
        let afterUnload = await pool.snapshot()
        XCTAssertEqual(afterUnload.unloadingModelIDs, [])
        XCTAssertEqual(afterUnload.reservedMemoryMB, 0)

        let second = try await pool.acquire(model: model("second"), estimatedMemoryMB: 200)
        XCTAssertEqual(second.session.modelId, "second")
        let secondReleased = await pool.release(second)
        XCTAssertTrue(secondReleased)
        try await pool.unload(modelId: "second")
    }

    func testWrongRuntimeSessionKeepsReservationUntilRejectedSessionUnloads() async throws {
        let engine = BlockingUnloadPoolTestEngine(returnedModelIdOverride: "unexpected")
        let configuration = try ModelPoolConfiguration(
            maxResidentMemoryMB: 512,
            maxLoadedModels: 2,
            minimumFreeMemoryMB: 64
        )
        let pool = ModelPool(engine: engine, configuration: configuration, availableMemoryMB: { 512 })
        let firstAcquire = Task {
            try await pool.acquire(model: model("expected"), estimatedMemoryMB: 400)
        }
        try await waitForTestCondition { !((await engine.hasStartedUnloading())) }

        let duringUnload = await pool.snapshot()
        XCTAssertEqual(duringUnload.unloadingModelIDs, ["expected"])
        XCTAssertEqual(duringUnload.reservedMemoryMB, 400)
        do {
            _ = try await pool.acquire(model: model("second"), estimatedMemoryMB: 200)
            XCTFail("Unexpected native session memory must remain reserved until unload returns")
        } catch ModelPoolError.insufficientMemory(let required, let available) {
            XCTAssertEqual(required, 200)
            XCTAssertEqual(available, 112)
        }

        await engine.finishUnloading()
        do {
            _ = try await firstAcquire.value
            XCTFail("The unexpected native session must be rejected")
        } catch ModelPoolError.runtimeReturnedWrongModel(let expected, let actual) {
            XCTAssertEqual(expected, "expected")
            XCTAssertEqual(actual, "unexpected")
        }
        let afterUnload = await pool.snapshot()
        XCTAssertEqual(afterUnload.reservedMemoryMB, 0)
        XCTAssertEqual(afterUnload.unloadingModelIDs, [])
    }

    func testUnloadingSessionCountsTowardLoadedModelLimit() async throws {
        let engine = BlockingUnloadPoolTestEngine()
        let configuration = try ModelPoolConfiguration(
            maxResidentMemoryMB: 1_024,
            maxLoadedModels: 1,
            minimumFreeMemoryMB: 64
        )
        let pool = ModelPool(engine: engine, configuration: configuration, availableMemoryMB: { 2_048 })
        let first = try await pool.acquire(model: model("first"), estimatedMemoryMB: 128)
        let released = await pool.release(first)
        XCTAssertTrue(released)

        let unloadTask = Task { try await pool.unload(modelId: "first") }
        try await waitForTestCondition { !((await engine.hasStartedUnloading())) }

        do {
            _ = try await pool.acquire(model: model("second"), estimatedMemoryMB: 128)
            XCTFail("An unloading native session must count toward the model limit")
        } catch ModelPoolError.modelLimitExceeded {
        }

        await engine.finishUnloading()
        try await unloadTask.value
        let second = try await pool.acquire(model: model("second"), estimatedMemoryMB: 128)
        XCTAssertEqual(second.session.modelId, "second")
        let secondReleased = await pool.release(second)
        XCTAssertTrue(secondReleased)
        try await pool.unload(modelId: "second")
    }

    private func makePool(
        engine: any LlamaEngine,
        maxMemory: Int = 2_048,
        maxModels: Int = 2,
        minimumFree: Int = 128
    ) throws -> ModelPool {
        let configuration = try ModelPoolConfiguration(
            maxResidentMemoryMB: maxMemory,
            maxLoadedModels: maxModels,
            minimumFreeMemoryMB: minimumFree
        )
        return ModelPool(engine: engine, configuration: configuration, availableMemoryMB: { 4_096 })
    }

    private func model(_ id: String) -> ModelDescriptor {
        ModelDescriptor(id: id, name: id, path: "/tmp/\(id).gguf", contextLength: 512, quantization: "Q4_K_M")
    }
}

private actor PoolTestEngine: LlamaEngine {
    private var calls = 0
    private var unloaded: [String] = []
    private var failFirstLoad: Bool

    init(failFirstLoad: Bool = false) { self.failFirstLoad = failFirstLoad }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        calls += 1
        if failFirstLoad {
            failFirstLoad = false
            throw LlamaEngineError.backendFailed("synthetic test load failure")
        }
        return RuntimeSession(id: "pool-session-\(calls)", modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        AsyncThrowingStream { $0.finish() }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async { unloaded.append(sessionId) }
    func loadCallCount() -> Int { calls }
    func unloadedSessionIDs() -> [String] { unloaded }
}

private actor BlockingPoolTestEngine: LlamaEngine {
    private var calls = 0
    private var continuation: CheckedContinuation<RuntimeSession, Never>?

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        calls += 1
        return await withCheckedContinuation { continuation = $0 }
    }

    func finishLoad() {
        continuation?.resume(returning: RuntimeSession(id: "shared-session", modelId: "shared"))
        continuation = nil
    }

    func loadCallCount() -> Int { calls }
    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        AsyncThrowingStream { $0.finish() }
    }
    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
}


private actor WrongModelPoolTestEngine: LlamaEngine {
    private var unloaded: [String] = []
    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: "wrong-session", modelId: "unexpected")
    }
    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        AsyncThrowingStream { $0.finish() }
    }
    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async { unloaded.append(sessionId) }
    func unloadedSessionIDs() -> [String] { unloaded }
}

private actor FixedSessionPoolTestEngine: LlamaEngine {
    private var unloaded: [String] = []
    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: "fixed-session", modelId: model.id)
    }
    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        AsyncThrowingStream { $0.finish() }
    }
    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async { unloaded.append(sessionId) }
    func unloadedSessionIDs() -> [String] { unloaded }
}

private actor BlockingUnloadPoolTestEngine: LlamaEngine {
    private var nextSession = 0
    private var unloadingStarted = false
    private var unloadContinuation: CheckedContinuation<Void, Never>?
    private let returnedModelIdOverride: String?

    init(returnedModelIdOverride: String? = nil) {
        self.returnedModelIdOverride = returnedModelIdOverride
    }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        nextSession += 1
        return RuntimeSession(
            id: "blocking-unload-\(nextSession)",
            modelId: returnedModelIdOverride ?? model.id
        )
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        AsyncThrowingStream { $0.finish() }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}

    func unload(sessionId: String) async {
        unloadingStarted = true
        await withCheckedContinuation { unloadContinuation = $0 }
    }

    func hasStartedUnloading() -> Bool { unloadingStarted }

    func finishUnloading() {
        unloadContinuation?.resume()
        unloadContinuation = nil
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
    while !(await condition()) {
        guard Date() < deadline else {
            XCTFail("Timed out waiting for asynchronous test condition", file: file, line: line)
            throw TestWaitTimeout()
        }
        try await Task.sleep(nanoseconds: 10_000_000)
    }
}

private struct TestWaitTimeout: Error {}

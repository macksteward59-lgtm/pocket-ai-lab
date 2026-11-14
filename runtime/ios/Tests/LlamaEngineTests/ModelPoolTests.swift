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

        XCTAssertTrue(awaitRelease(pool, first))
        let duplicateRelease = await pool.release(first)
        XCTAssertFalse(duplicateRelease)
        XCTAssertTrue(awaitRelease(pool, second))
        try await pool.unload(modelId: "alpha")

        let unloaded = await engine.unloadedSessionIDs()
        XCTAssertEqual(unloaded, [first.session.id])
        let after = await pool.snapshot()
        XCTAssertEqual(after.reservedMemoryMB, 0)
        XCTAssertTrue(after.loadedModelIDs.isEmpty)
    }

    func testMemoryBudgetAndModelCountAreEnforcedBeforeLoading() async throws {
        let engine = PoolTestEngine()
        let pool = try makePool(engine: engine, maxMemory: 512, maxModels: 1, minimumFree: 64)

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
        XCTAssertTrue(awaitRelease(pool, lease))
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
        XCTAssertTrue(awaitRelease(pool, lease))
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
        XCTAssertTrue(awaitRelease(pool, lease))
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
        while await engine.loadCallCount() == 0 { await Task.yield() }

        let secondTask = Task {
            try await pool.acquire(model: descriptor, estimatedMemoryMB: 512)
        }
        while (await pool.snapshot()).pendingModelIDs.isEmpty { await Task.yield() }
        await engine.finishLoad()

        let first = try await firstTask.value
        let second = try await secondTask.value
        XCTAssertEqual(first.session, second.session)
        let calls = await engine.loadCallCount()
        XCTAssertEqual(calls, 1)

        XCTAssertTrue(awaitRelease(pool, first))
        XCTAssertTrue(awaitRelease(pool, second))
        try await pool.unload(modelId: "shared")
    }

    func testUnloadIdleModelsLeavesActivelyLeasedSessionsAlone() async throws {
        let engine = PoolTestEngine()
        let pool = try makePool(engine: engine, maxMemory: 2_048, maxModels: 2)
        let idle = try await pool.acquire(model: model("idle"), estimatedMemoryMB: 256)
        let active = try await pool.acquire(model: model("active"), estimatedMemoryMB: 256)
        XCTAssertTrue(awaitRelease(pool, idle))

        let unloaded = await pool.unloadIdleModels()
        XCTAssertEqual(unloaded, ["idle"])
        let snapshot = await pool.snapshot()
        XCTAssertEqual(snapshot.loadedModelIDs, ["active"])
        XCTAssertEqual(snapshot.activeLeaseCount, 1)

        XCTAssertTrue(awaitRelease(pool, active))
        let remaining = await pool.unloadIdleModels()
        XCTAssertEqual(remaining, ["active"])
        let final = await pool.snapshot()
        XCTAssertEqual(final.reservedMemoryMB, 0)
    }

    func testInvalidConfigurationAndResourceSnapshotAreRejected() throws {
        XCTAssertThrowsError(try ModelPoolConfiguration(maxResidentMemoryMB: 0, maxLoadedModels: 1))
        let engine = PoolTestEngine()
        let configuration = try ModelPoolConfiguration(maxResidentMemoryMB: 1_024, maxLoadedModels: 1)
        let pool = ModelPool(engine: engine, configuration: configuration, availableMemoryMB: { -1 })
        let leaseTask = Task { try await pool.acquire(model: model("invalid-memory"), estimatedMemoryMB: 128) }
        do {
            _ = try await leaseTask.value
            XCTFail("Negative system memory must fail closed")
        } catch ModelPoolError.invalidResourceSnapshot {
        }
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

    private func awaitRelease(_ pool: ModelPool, _ lease: ModelPoolLease) async -> Bool {
        await pool.release(lease)
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
    func unload(sessionId: String) async {}
}

import XCTest
@testable import PocketLlamaEngine

final class InferenceSchedulerTests: XCTestCase {
    func testFIFOWaitersReceivePermitsInArrivalOrder() async throws {
        let scheduler = try InferenceScheduler(maxConcurrentRequests: 1)
        let gate = SchedulerGate()

        let first = Task {
            try await scheduler.withPermit {
                await gate.hold(1)
                return 1
            }
        }
        try await waitForTestCondition { await gate.orderSnapshot().isEmpty }

        let second = Task {
            try await scheduler.withPermit {
                await gate.record(2)
                return 2
            }
        }
        let third = Task {
            try await scheduler.withPermit {
                await gate.record(3)
                return 3
            }
        }
        try await waitForTestCondition { (await scheduler.snapshot()).waitingRequests < 2 }

        await gate.releaseOne()
        let firstResult = try await first.value
        let secondResult = try await second.value
        let thirdResult = try await third.value
        XCTAssertEqual([firstResult, secondResult, thirdResult], [1, 2, 3])
        let order = await gate.orderSnapshot()
        XCTAssertEqual(order, [1, 2, 3])
        let snapshot = await scheduler.snapshot()
        XCTAssertEqual(snapshot.activeRequests, 0)
        XCTAssertEqual(snapshot.waitingRequests, 0)
    }

    func testConcurrencyLimitAllowsTwoAndQueuesTheThird() async throws {
        let scheduler = try InferenceScheduler(maxConcurrentRequests: 2)
        let gate = MultiWaiterGate()
        let tasks = (1...3).map { value in
            Task {
                try await scheduler.withPermit {
                    await gate.hold(value)
                    return value
                }
            }
        }

        try await waitForTestCondition { await gate.startedCount() < 2 }
        let waiting = await scheduler.snapshot()
        XCTAssertEqual(waiting.activeRequests, 2)
        XCTAssertEqual(waiting.waitingRequests, 1)
        let maximumBeforeRelease = await gate.maximumActiveCount()
        XCTAssertEqual(maximumBeforeRelease, 2)

        await gate.releaseOne()
        try await waitForTestCondition { await gate.startedCount() < 3 }
        await gate.releaseAll()

        let firstResult = try await tasks[0].value
        let secondResult = try await tasks[1].value
        let thirdResult = try await tasks[2].value
        XCTAssertEqual([firstResult, secondResult, thirdResult].sorted(), [1, 2, 3])
        let maximumAfterRelease = await gate.maximumActiveCount()
        XCTAssertLessThanOrEqual(maximumAfterRelease, 2)
        let final = await scheduler.snapshot()
        XCTAssertEqual(final.activeRequests, 0)
        XCTAssertEqual(final.waitingRequests, 0)
    }

    func testCancelledWaiterIsRemovedWithoutConsumingCapacity() async throws {
        let scheduler = try InferenceScheduler(maxConcurrentRequests: 1)
        let gate = SchedulerGate()
        let first = Task {
            try await scheduler.withPermit {
                await gate.hold(1)
                return 1
            }
        }
        try await waitForTestCondition { await gate.orderSnapshot().isEmpty }

        let second = Task {
            try await scheduler.withPermit {
                await gate.record(2)
                return 2
            }
        }
        try await waitForTestCondition { (await scheduler.snapshot()).waitingRequests == 0 }
        second.cancel()
        do {
            _ = try await second.value
            XCTFail("Cancelled waiter must not run")
        } catch is CancellationError {
        }

        let waiting = await scheduler.snapshot()
        XCTAssertEqual(waiting.waitingRequests, 0)
        await gate.releaseOne()
        let firstResult = try await first.value
        XCTAssertEqual(firstResult, 1)
        let order = await gate.orderSnapshot()
        XCTAssertEqual(order, [1])
        let finalSnapshot = await scheduler.snapshot()
        XCTAssertEqual(finalSnapshot.activeRequests, 0)
    }

    func testOperationFailureReleasesItsPermit() async throws {
        let scheduler = try InferenceScheduler(maxConcurrentRequests: 1)
        do {
            let _: Int = try await scheduler.withPermit {
                throw SchedulerTestError.failed
            }
            XCTFail("The operation should fail")
        } catch SchedulerTestError.failed {
        }
        let result = try await scheduler.withPermit { 42 }
        XCTAssertEqual(result, 42)
        let finalSnapshot = await scheduler.snapshot()
        XCTAssertEqual(finalSnapshot.activeRequests, 0)
    }

    func testInvalidConcurrencyLimitIsRejected() {
        XCTAssertThrowsError(try InferenceScheduler(maxConcurrentRequests: 0))
        XCTAssertThrowsError(try InferenceScheduler(maxConcurrentRequests: 9))
    }
}

private enum SchedulerTestError: Error {
    case failed
}

private actor SchedulerGate {
    private var order: [Int] = []
    private var continuation: CheckedContinuation<Void, Never>?

    func hold(_ value: Int) async {
        order.append(value)
        await withCheckedContinuation { continuation = $0 }
    }

    func record(_ value: Int) { order.append(value) }
    func releaseOne() {
        continuation?.resume()
        continuation = nil
    }
    func orderSnapshot() -> [Int] { order }
}

private actor MultiWaiterGate {
    private var active = 0
    private var maximumActive = 0
    private var started: [Int] = []
    private var continuations: [CheckedContinuation<Void, Never>] = []

    func hold(_ value: Int) async {
        active += 1
        maximumActive = max(maximumActive, active)
        started.append(value)
        await withCheckedContinuation { continuations.append($0) }
        active -= 1
    }

    func startedCount() -> Int { started.count }
    func maximumActiveCount() -> Int { maximumActive }

    func releaseOne() {
        guard !continuations.isEmpty else { return }
        continuations.removeFirst().resume()
    }

    func releaseAll() {
        let pending = continuations
        continuations.removeAll()
        pending.forEach { $0.resume() }
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

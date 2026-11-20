import Foundation

public enum InferenceSchedulerError: Error, Equatable, Sendable {
    case invalidConcurrencyLimit
}

public struct InferenceSchedulerSnapshot: Sendable, Equatable {
    public let activeRequests: Int
    public let waitingRequests: Int
    public let maxConcurrentRequests: Int
}

/// FIFO admission control for native inference work. A permit is held for the
/// full async operation and is released on success, failure, or cancellation.
public actor InferenceScheduler {
    private struct Waiter {
        let id: UUID
        let continuation: CheckedContinuation<Void, Error>
    }

    public let maxConcurrentRequests: Int
    private var activeRequests = 0
    private var waiters: [Waiter] = []

    public init(maxConcurrentRequests: Int = 1) throws {
        guard (1...8).contains(maxConcurrentRequests) else {
            throw InferenceSchedulerError.invalidConcurrencyLimit
        }
        self.maxConcurrentRequests = maxConcurrentRequests
    }

    public func withPermit<T: Sendable>(
        _ operation: @escaping @Sendable () async throws -> T
    ) async throws -> T {
        let waiterId = UUID()
        try await acquire(waiterId)
        // Install release before checking cancellation so a cancellation that
        // races with permit grant cannot leak capacity.
        defer { releasePermit() }
        try Task.checkCancellation()
        return try await operation()
    }

    public func snapshot() -> InferenceSchedulerSnapshot {
        InferenceSchedulerSnapshot(
            activeRequests: activeRequests,
            waitingRequests: waiters.count,
            maxConcurrentRequests: maxConcurrentRequests
        )
    }

    private func acquire(_ id: UUID) async throws {
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if Task.isCancelled {
                    continuation.resume(throwing: CancellationError())
                } else if activeRequests < maxConcurrentRequests {
                    activeRequests += 1
                    continuation.resume()
                } else {
                    waiters.append(Waiter(id: id, continuation: continuation))
                }
            }
        } onCancel: {
            Task { await self.cancelWaiter(id) }
        }
    }

    private func cancelWaiter(_ id: UUID) {
        guard let index = waiters.firstIndex(where: { $0.id == id }) else { return }
        let waiter = waiters.remove(at: index)
        waiter.continuation.resume(throwing: CancellationError())
    }

    private func releasePermit() {
        guard activeRequests > 0 else { return }
        if !waiters.isEmpty {
            // Transfer the existing permit directly to the oldest waiter.
            // activeRequests remains unchanged during the transfer.
            let next = waiters.removeFirst()
            next.continuation.resume()
        } else {
            activeRequests -= 1
        }
    }
}

import Foundation

public enum NativeInferenceRuntimeError: Error, Equatable, Sendable {
    case invalidOutputLimit
    case responseTooLarge
}

/// The single native composition root for model ownership and inference admission.
///
/// A ModelPool lease protects a session; an InferenceScheduler permit protects
/// the complete generation stream. Callers must keep the lease until every
/// generation using its session has completed or has been cancelled and drained.
public struct NativeInferenceRuntime: Sendable {
    public let engine: any LlamaEngine
    private let pool: ModelPool
    private let scheduler: InferenceScheduler

    public init(
        engine: any LlamaEngine,
        poolConfiguration: ModelPoolConfiguration,
        availableMemoryMB: @escaping @Sendable () -> Int,
        maxConcurrentRequests: Int = 1
    ) throws {
        self.engine = engine
        self.pool = ModelPool(
            engine: engine,
            configuration: poolConfiguration,
            availableMemoryMB: availableMemoryMB
        )
        self.scheduler = try InferenceScheduler(maxConcurrentRequests: maxConcurrentRequests)
    }

    public func acquire(
        model: ModelDescriptor,
        estimatedMemoryMB: Int
    ) async throws -> ModelPoolLease {
        try await pool.acquire(model: model, estimatedMemoryMB: estimatedMemoryMB)
    }

    @discardableResult
    public func release(_ lease: ModelPoolLease) async -> Bool {
        await pool.release(lease)
    }

    public func unload(modelId: String) async throws {
        try await pool.unload(modelId: modelId)
    }

    @discardableResult
    public func unloadIdleModels() async -> [String] {
        await pool.unloadIdleModels()
    }

    public func snapshot() async -> ModelPoolSnapshot {
        await pool.snapshot()
    }

    public func schedulerSnapshot() async -> InferenceSchedulerSnapshot {
        await scheduler.snapshot()
    }

    /// Holds one exact model lease until the supplied operation has fully returned.
    /// The operation must await all inference and cancellation-drain work; it must
    /// not detach work that continues using the supplied session after returning.
    public func withLease<T: Sendable>(
        model: ModelDescriptor,
        estimatedMemoryMB: Int,
        operation: @escaping @Sendable (ModelPoolLease) async throws -> T
    ) async throws -> T {
        let lease = try await pool.acquire(model: model, estimatedMemoryMB: estimatedMemoryMB)
        do {
            let result = try await operation(lease)
            _ = await pool.release(lease)
            return result
        } catch {
            _ = await pool.release(lease)
            throw error
        }
    }

    /// Runs one complete generation under the shared scheduler permit.
    ///
    /// On stream failure, cancellation, or output-limit rejection, the engine's
    /// cancelAndWait contract is awaited before the permit is released.
    public func generate(
        session: RuntimeSession,
        request: GenerationRequest,
        maxOutputBytes: Int = 64_000
    ) async throws -> String {
        guard maxOutputBytes > 0 else {
            throw NativeInferenceRuntimeError.invalidOutputLimit
        }

        return try await scheduler.withPermit {
            let stream = try await engine.generate(session: session, request: request)
            var output = ""
            do {
                for try await token in stream {
                    try Task.checkCancellation()
                    let (nextCount, overflow) = output.utf8.count.addingReportingOverflow(token.text.utf8.count)
                    guard !overflow, nextCount <= maxOutputBytes else {
                        throw NativeInferenceRuntimeError.responseTooLarge
                    }
                    output += token.text
                }
                try Task.checkCancellation()
                return output
            } catch {
                await engine.cancelAndWait(sessionId: session.id, requestId: request.requestId)
                throw error
            }
        }
    }

    public func makeAgentCoordinator(for lease: ModelPoolLease) -> NativeAgentCoordinator {
        NativeAgentCoordinator(runtime: self, lease: lease)
    }
}

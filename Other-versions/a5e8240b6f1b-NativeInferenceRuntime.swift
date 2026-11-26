import Foundation

public enum NativeInferenceRuntimeError: Error, Equatable, Sendable {
    case invalidOutputLimit
    case responseTooLarge
    case latentExportUnavailable
    case invalidLatentOutput
}


public enum NativeInferenceProviderKind: String, Sendable, Equatable {
    case llamaCpp
    case other
}

public struct NativeInferenceEvaluationResult: Sendable, Equatable {
    public enum Status: String, Sendable, Equatable {
        case completed
        case partial
        case failed
    }

    public let output: String
    public let status: Status
    public let errorMessage: String?

    public init(output: String, status: Status, errorMessage: String?) {
        self.output = output
        self.status = status
        self.errorMessage = errorMessage
    }
}

/// The single native composition root for model ownership and inference admission.
///
/// A ModelPool lease protects a session; an InferenceScheduler permit protects
/// the complete generation stream. Callers must keep the lease until every
/// generation using its session has completed or has been cancelled and drained.
public struct NativeInferenceRuntime: Sendable {
    let engine: any LlamaEngine
    private let pool: ModelPool
    private let scheduler: InferenceScheduler

    /// Derived from the engine this runtime actually owns; callers cannot label a mock as llama.cpp.
    public var providerKind: NativeInferenceProviderKind {
        engine is LlamaCppMetalBackend ? .llamaCpp : .other
    }

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
    /// Runs generation only through an exact active ModelPool lease.
    /// An internal use pin prevents unload until stream completion or cancellation drain.
    public func generate(
        lease: ModelPoolLease,
        request: GenerationRequest,
        maxOutputBytes: Int = 64_000
    ) async throws -> String {
        guard maxOutputBytes > 0 else {
            throw NativeInferenceRuntimeError.invalidOutputLimit
        }
        let use = try await pool.beginUse(lease)
        do {
            let result = try await scheduler.withPermit {
                let stream = try await engine.generate(session: lease.session, request: request)
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
                    await engine.cancelAndWait(sessionId: lease.session.id, requestId: request.requestId)
                    throw error
                }
            }
            await pool.endUse(use)
            return result
        } catch {
            await pool.endUse(use)
            throw error
        }
    }


    /// Generates text and a bounded final-token embedding under the same model lease and scheduler permit.
    /// The embedding is data, not an authorization receipt or a cross-model compatibility guarantee.
    public func generateWithLatent(
        lease: ModelPoolLease,
        request: GenerationRequest,
        maxOutputBytes: Int = 64_000
    ) async throws -> LlamaLatentOutput {
        guard maxOutputBytes > 0 else {
            throw NativeInferenceRuntimeError.invalidOutputLimit
        }
        guard let latentEngine = engine as? any LatentExportingLlamaEngine else {
            throw NativeInferenceRuntimeError.latentExportUnavailable
        }
        let use = try await pool.beginUse(lease)
        do {
            let result = try await scheduler.withPermit {
                do {
                    let output = try await latentEngine.generateWithLatent(
                        session: lease.session,
                        request: request
                    )
                    try Task.checkCancellation()
                    guard output.text.utf8.count <= maxOutputBytes else {
                        throw NativeInferenceRuntimeError.responseTooLarge
                    }
                    guard output.modelId == lease.session.modelId,
                          !output.embedding.isEmpty,
                          output.shape == [output.embedding.count],
                          output.embedding.allSatisfy(\.isFinite) else {
                        throw NativeInferenceRuntimeError.invalidLatentOutput
                    }
                    return output
                } catch {
                    await latentEngine.cancelAndWait(
                        sessionId: lease.session.id,
                        requestId: request.requestId
                    )
                    throw error
                }
            }
            await pool.endUse(use)
            return result
        } catch {
            await pool.endUse(use)
            throw error
        }
    }

    /// Generates an ordered, bounded sequence of final-layer embeddings under the same lease and scheduler permit.
    public func generateWithLatentSequence(
        lease: ModelPoolLease,
        request: GenerationRequest,
        maxLatentTokens: Int = 256,
        maxLatentBytes: Int = 16 * 1024 * 1024,
        maxOutputBytes: Int = 64_000
    ) async throws -> LlamaLatentSequenceOutput {
        guard maxOutputBytes > 0,
              maxLatentTokens > 0, maxLatentTokens <= 256,
              maxLatentBytes > 0, maxLatentBytes <= 16 * 1024 * 1024,
              request.maxTokens <= maxLatentTokens else {
            throw NativeInferenceRuntimeError.invalidOutputLimit
        }
        guard let sequenceEngine = engine as? any LatentSequenceExportingLlamaEngine else {
            throw NativeInferenceRuntimeError.latentExportUnavailable
        }
        let use = try await pool.beginUse(lease)
        do {
            let result = try await scheduler.withPermit {
                do {
                    let output = try await sequenceEngine.generateWithLatentSequence(
                        session: lease.session,
                        request: request,
                        maxLatentTokens: maxLatentTokens,
                        maxLatentBytes: maxLatentBytes
                    )
                    try Task.checkCancellation()
                    let (expectedFloats, overflow) = output.tokenCount.multipliedReportingOverflow(by: output.embeddingDimension)
                    guard !overflow,
                          output.modelId == lease.session.modelId,
                          output.tokenCount > 0, output.tokenCount <= maxLatentTokens,
                          output.embeddingDimension > 0, output.embeddingDimension <= 65_536,
                          expectedFloats == output.embeddings.count,
                          expectedFloats <= maxLatentBytes / MemoryLayout<Float>.size,
                          output.shape == [output.tokenCount, output.embeddingDimension],
                          output.text.utf8.count <= maxOutputBytes,
                          output.embeddings.allSatisfy(\.isFinite) else {
                        throw NativeInferenceRuntimeError.invalidLatentOutput
                    }
                    return output
                } catch {
                    await sequenceEngine.cancelAndWait(
                        sessionId: lease.session.id,
                        requestId: request.requestId
                    )
                    throw error
                }
            }
            await pool.endUse(use)
            return result
        } catch {
            await pool.endUse(use)
            throw error
        }
    }

    /// Evaluation variant of generate that retains partial output and structured failure details.
    /// It uses the same exact lease, use pin, scheduler permit, output bound, and cancellation drain
    /// as ordinary chat. Invalid/released/foreign leases still throw before inference.
    public func generateForEvaluation(
        lease: ModelPoolLease,
        request: GenerationRequest,
        maxOutputBytes: Int = 64_000
    ) async throws -> NativeInferenceEvaluationResult {
        guard maxOutputBytes > 0 else {
            throw NativeInferenceRuntimeError.invalidOutputLimit
        }
        let use = try await pool.beginUse(lease)
        do {
            let result = try await scheduler.withPermit {
                var output = ""
                do {
                    let stream = try await engine.generate(session: lease.session, request: request)
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
                        let hasOutput = !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        return NativeInferenceEvaluationResult(
                            output: output,
                            status: hasOutput ? .completed : .failed,
                            errorMessage: hasOutput ? nil : "Runtime completed without producing output."
                        )
                    } catch {
                        await engine.cancelAndWait(sessionId: lease.session.id, requestId: request.requestId)
                        let hasPartialOutput = !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        return NativeInferenceEvaluationResult(
                            output: output,
                            status: hasPartialOutput ? .partial : .failed,
                            errorMessage: String(describing: error)
                        )
                    }
                } catch {
                    return NativeInferenceEvaluationResult(
                        output: output,
                        status: .failed,
                        errorMessage: String(describing: error)
                    )
                }
            }
            await pool.endUse(use)
            return result
        } catch {
            await pool.endUse(use)
            throw error
        }
    }

    public func makeAgentCoordinator(for lease: ModelPoolLease) -> NativeAgentCoordinator {
        NativeAgentCoordinator(runtime: self, lease: lease)
    }
}

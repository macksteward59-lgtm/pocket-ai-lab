import Foundation

public enum ModelPoolError: Error, Equatable, Sendable {
    case invalidConfiguration
    case invalidMemoryEstimate
    case invalidResourceSnapshot
    case insufficientMemory(requiredMB: Int, availableMB: Int)
    case modelLimitExceeded
    case descriptorConflict(String)
    case modelBusy(String)
    case modelLoading(String)
    case activeLeases(modelId: String, count: Int)
    case unknownModel(String)
    case runtimeReturnedWrongModel(expected: String, actual: String)
    case runtimeSessionCollision(String)
    case modelLoadDidNotComplete(String)
}

/// Pool-owned memory budget. Estimates are admission-control hints, not measured RSS.
public struct ModelPoolConfiguration: Sendable, Equatable {
    public let maxResidentMemoryMB: Int
    public let maxLoadedModels: Int
    public let minimumFreeMemoryMB: Int

    public init(
        maxResidentMemoryMB: Int,
        maxLoadedModels: Int,
        minimumFreeMemoryMB: Int = 128
    ) throws {
        guard maxResidentMemoryMB > 0,
              (1...8).contains(maxLoadedModels),
              minimumFreeMemoryMB >= 0,
              minimumFreeMemoryMB < maxResidentMemoryMB else {
            throw ModelPoolError.invalidConfiguration
        }
        self.maxResidentMemoryMB = maxResidentMemoryMB
        self.maxLoadedModels = maxLoadedModels
        self.minimumFreeMemoryMB = minimumFreeMemoryMB
    }
}

/// A lease is a capability to use one exact loaded session. Release the lease
/// when the caller has finished all inference work against that session.
public struct ModelPoolLease: Sendable, Equatable {
    public let leaseId: String
    public let model: ModelDescriptor
    public let session: RuntimeSession
    public let estimatedMemoryMB: Int
}

public struct ModelPoolSnapshot: Sendable, Equatable {
    public let loadedModelIDs: [String]
    public let pendingModelIDs: [String]
    /// Models whose native unload call has not returned yet.
    public let unloadingModelIDs: [String]
    public let activeLeaseCount: Int
    public let pendingAcquirerCount: Int
    public let reservedMemoryMB: Int
}

/// Actor-isolated native model pool with coalesced loads and exact lease release.
///
/// The injected memory provider reports current system-available memory. The
/// pool separately enforces its own estimate budget. Estimates do not prove
/// actual resident memory and must be calibrated with physical-device tests.
public actor ModelPool {
    private struct Entry {
        let descriptor: ModelDescriptor
        let session: RuntimeSession
        let estimatedMemoryMB: Int
        var leaseIDs: Set<String>
        var lastUsedSequence: UInt64
    }

    private struct PendingLoad {
        let token: String
        let descriptor: ModelDescriptor
        let estimatedMemoryMB: Int
        let task: Task<RuntimeSession, Error>
        var waitingAcquirers: Int
    }

    private let engine: any LlamaEngine
    private let configuration: ModelPoolConfiguration
    private let availableMemoryMB: @Sendable () -> Int

    private var entries: [String: Entry] = [:]
    private var pendingLoads: [String: PendingLoad] = [:]
    private var unloading: Set<String> = []
    private var reservedMemoryMB = 0
    private var useSequence: UInt64 = 0

    public init(
        engine: any LlamaEngine,
        configuration: ModelPoolConfiguration,
        availableMemoryMB: @escaping @Sendable () -> Int
    ) {
        self.engine = engine
        self.configuration = configuration
        self.availableMemoryMB = availableMemoryMB
    }

    public func acquire(
        model: ModelDescriptor,
        estimatedMemoryMB: Int
    ) async throws -> ModelPoolLease {
        try Task.checkCancellation()
        try LlamaEngineSupport.validateModel(model)
        guard estimatedMemoryMB > 0 else {
            throw ModelPoolError.invalidMemoryEstimate
        }
        guard !unloading.contains(model.id) else {
            throw ModelPoolError.modelBusy(model.id)
        }

        if let entry = entries[model.id] {
            guard entry.descriptor == model,
                  entry.estimatedMemoryMB == estimatedMemoryMB else {
                throw ModelPoolError.descriptorConflict(model.id)
            }
            return makeLease(modelId: model.id)
        }

        if let pending = pendingLoads[model.id] {
            guard pending.descriptor == model,
                  pending.estimatedMemoryMB == estimatedMemoryMB else {
                throw ModelPoolError.descriptorConflict(model.id)
            }
            var joined = pending
            joined.waitingAcquirers += 1
            pendingLoads[model.id] = joined
            return try await resolve(joined)
        }

        // An unloading session may still occupy native resources until the
        // engine's async unload returns, so it continues to count toward the
        // loaded-model cap during actor reentrancy.
        guard entries.count + pendingLoads.count + unloading.count < configuration.maxLoadedModels else {
            throw ModelPoolError.modelLimitExceeded
        }

        let systemAvailable = availableMemoryMB()
        guard systemAvailable >= 0 else {
            throw ModelPoolError.invalidResourceSnapshot
        }
        let poolAvailable = configuration.maxResidentMemoryMB - reservedMemoryMB
        let systemAvailableAfterReserve = max(
            0,
            systemAvailable - reservedMemoryMB - configuration.minimumFreeMemoryMB
        )
        let available = min(poolAvailable, systemAvailableAfterReserve)
        guard estimatedMemoryMB <= available else {
            throw ModelPoolError.insufficientMemory(requiredMB: estimatedMemoryMB, availableMB: available)
        }

        let inferenceEngine = engine
        let pending = PendingLoad(
            token: UUID().uuidString,
            descriptor: model,
            estimatedMemoryMB: estimatedMemoryMB,
            task: Task { try await inferenceEngine.load(model: model) },
            waitingAcquirers: 1
        )
        reservedMemoryMB += estimatedMemoryMB
        pendingLoads[model.id] = pending
        return try await resolve(pending)
    }

    /// Releases one exact lease. Repeated or stale releases return false.
    @discardableResult
    public func release(_ lease: ModelPoolLease) -> Bool {
        guard var entry = entries[lease.model.id],
              entry.session == lease.session,
              entry.descriptor == lease.model,
              entry.leaseIDs.remove(lease.leaseId) != nil else {
            return false
        }
        useSequence &+= 1
        entry.lastUsedSequence = useSequence
        entries[lease.model.id] = entry
        return true
    }

    /// Unloads an idle model. Active leases and pending loads cannot be bypassed.
    public func unload(modelId: String) async throws {
        guard !pendingLoads.keys.contains(modelId) else {
            throw ModelPoolError.modelLoading(modelId)
        }
        guard let entry = entries[modelId] else {
            throw ModelPoolError.unknownModel(modelId)
        }
        guard entry.leaseIDs.isEmpty else {
            throw ModelPoolError.activeLeases(modelId: modelId, count: entry.leaseIDs.count)
        }

        unloading.insert(modelId)
        entries[modelId] = nil
        // Keep the reservation until the native engine confirms unload has
        // returned. Actor reentrancy allows other models to acquire while this
        // await is suspended; releasing the budget first would over-admit
        // memory while the old session may still be resident.
        await engine.unload(sessionId: entry.session.id)
        reservedMemoryMB = max(0, reservedMemoryMB - entry.estimatedMemoryMB)
        unloading.remove(modelId)
    }

    /// Unloads every currently idle model and leaves active leases untouched.
    @discardableResult
    public func unloadIdleModels() async -> [String] {
        let idle = entries
            .filter { $0.value.leaseIDs.isEmpty }
            .sorted { $0.value.lastUsedSequence < $1.value.lastUsedSequence }
            .map { $0.key }
        var unloaded: [String] = []
        for modelId in idle {
            do {
                try await unload(modelId: modelId)
                unloaded.append(modelId)
            } catch {
                // A concurrent acquire may have taken a lease while this actor
                // was suspended in a prior unload. Keep that model resident.
            }
        }
        return unloaded
    }

    public func snapshot() -> ModelPoolSnapshot {
        ModelPoolSnapshot(
            loadedModelIDs: entries.keys.sorted(),
            pendingModelIDs: pendingLoads.keys.sorted(),
            unloadingModelIDs: unloading.sorted(),
            activeLeaseCount: entries.values.reduce(0) { $0 + $1.leaseIDs.count },
            pendingAcquirerCount: pendingLoads.values.reduce(0) { $0 + $1.waitingAcquirers },
            reservedMemoryMB: reservedMemoryMB
        )
    }

    private func resolve(_ pending: PendingLoad) async throws -> ModelPoolLease {
        let session: RuntimeSession
        do {
            session = try await pending.task.value
        } catch {
            failPending(pending)
            throw error
        }

        if let existing = entries[pending.descriptor.id] {
            guard existing.descriptor == pending.descriptor,
                  existing.session == session else {
                throw ModelPoolError.descriptorConflict(pending.descriptor.id)
            }
        } else if pendingLoads[pending.descriptor.id]?.token == pending.token {
            let collision = entries.values.contains { $0.session.id == session.id }
            guard !collision else {
                pendingLoads[pending.descriptor.id] = nil
                reservedMemoryMB = max(0, reservedMemoryMB - pending.estimatedMemoryMB)
                // Never unload a colliding ID: it may be the active session
                // already owned by another model entry.
                throw ModelPoolError.runtimeSessionCollision(session.id)
            }
            guard session.modelId == pending.descriptor.id else {
                pendingLoads[pending.descriptor.id] = nil
                unloading.insert(pending.descriptor.id)
                // The unexpected native session may still occupy memory while
                // unload suspends. Keep its reservation until unload returns.
                await engine.unload(sessionId: session.id)
                reservedMemoryMB = max(0, reservedMemoryMB - pending.estimatedMemoryMB)
                unloading.remove(pending.descriptor.id)
                throw ModelPoolError.runtimeReturnedWrongModel(
                    expected: pending.descriptor.id,
                    actual: session.modelId
                )
            }
            pendingLoads[pending.descriptor.id] = nil
            entries[pending.descriptor.id] = Entry(
                descriptor: pending.descriptor,
                session: session,
                estimatedMemoryMB: pending.estimatedMemoryMB,
                leaseIDs: [],
                lastUsedSequence: useSequence
            )
        } else {
            throw ModelPoolError.modelLoadDidNotComplete(pending.descriptor.id)
        }

        let lease = makeLease(modelId: pending.descriptor.id)
        if Task.isCancelled {
            _ = release(lease)
            throw CancellationError()
        }
        return lease
    }

    private func failPending(_ pending: PendingLoad) {
        guard pendingLoads[pending.descriptor.id]?.token == pending.token else { return }
        pendingLoads[pending.descriptor.id] = nil
        reservedMemoryMB = max(0, reservedMemoryMB - pending.estimatedMemoryMB)
    }

    private func makeLease(modelId: String) -> ModelPoolLease {
        guard var entry = entries[modelId] else {
            preconditionFailure("ModelPool.makeLease requires a loaded entry")
        }
        useSequence &+= 1
        let leaseId = UUID().uuidString
        entry.leaseIDs.insert(leaseId)
        entry.lastUsedSequence = useSequence
        entries[modelId] = entry
        return ModelPoolLease(
            leaseId: leaseId,
            model: entry.descriptor,
            session: entry.session,
            estimatedMemoryMB: entry.estimatedMemoryMB
        )
    }
}

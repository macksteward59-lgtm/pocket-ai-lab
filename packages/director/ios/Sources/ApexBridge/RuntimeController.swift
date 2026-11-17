import CryptoKit
import Foundation
import PocketLlamaEngine

public struct ModelReport: Codable, Sendable, Equatable {
    public let id: String
    public let phase: String
    public let canGenerate: Bool
    public let sessionId: String?
    public let fileHash: String?
    public let runtimeVersion: String?
    public let healthCheckId: String?
    public let expiresAt: Date?
}

public struct RuntimeGenerationRecord: Codable, Sendable, Equatable {
    public let requestId: String
    public let conversationRequestId: String
    public let attemptId: String
    public let modelId: String
    public let modelFileHash: String
    public let runtimeSessionId: String
    public let runtimeVersion: String
    public let deviceId: String
    public let runtimeIdentity: String
    public let challengeNonce: String
    public let generationResultHash: String
    public let generatedAt: Date
    public let healthCheckId: String
    public let output: String

    /// This is an unsigned evidence candidate. It is not a receipt, authorization,
    /// device attestation, or proof until the Director verifies and signs it.
    public var authorized: Bool { false }
}

public enum RuntimeControllerError: Error, Equatable, Sendable {
    case invalidConfiguration
    case modelFileUnavailable
    case modelFileChanged
    case modelHashMismatch
    case unknownSession
    case notReady
    case invalidRequest
    case unauthorizedChallenge
    case duplicateRequest
    case duplicateSession
    case emptyGeneration
}

/// Actor-isolated adapter from the Director bridge to the shared native runtime.
/// It owns exact ModelPool leases and uses the runtime's scheduler/cancellation
/// drain. It never stores GGUF bytes or accepts a Director signing key.
public actor RuntimeController {
    private struct ModelFileIdentity: Equatable, Sendable {
        let size: Int64
        let modifiedAt: Date?
    }

    private struct Readiness: Sendable {
        let healthCheckId: String
        let checkedAt: Date
        let expiresAt: Date
    }

    private struct ActiveSession {
        let lease: ModelPoolLease
        let fileHash: String
        let fileIdentity: ModelFileIdentity
        var readiness: Readiness?
        var readinessTaskId: String?
        var readinessTask: Task<String, Error>?
        var generations: [String: Task<String, Error>]
    }

    private let runtime: NativeInferenceRuntime
    private let challengeStore: BridgeChallengeConsuming
    private let trustedWorkspaceURL: URL
    public let runtimeVersion: String
    public let deviceId: String
    public let runtimeIdentity: String
    private let readinessTTL: TimeInterval
    private let clock: @Sendable () -> Date
    private let fileHasher: @Sendable (URL) async throws -> String
    private var sessions: [String: ActiveSession] = [:]
    private var unloadingSessions: Set<String> = []
    // Invalidates generation attempts suspended before their native task is registered.
    private var generationLifecycle: UInt64 = 0
    private var generationDrainCount = 0

    public init(
        runtime: NativeInferenceRuntime,
        deviceId: String,
        runtimeIdentity: String,
        challengeStore: BridgeChallengeConsuming,
        trustedWorkspaceURL: URL,
        runtimeVersion: String = "pocket-ai-lab-native/1",
        readinessTTL: TimeInterval = 120,
        clock: @escaping @Sendable () -> Date = { Date() },
        fileHasher: (@Sendable (URL) async throws -> String)? = nil
    ) throws {
        guard !deviceId.isEmpty, deviceId.utf8.count <= 128,
              !runtimeIdentity.isEmpty, runtimeIdentity.utf8.count <= 128,
              !runtimeVersion.isEmpty, runtimeVersion.utf8.count <= 128,
              readinessTTL.isFinite, (1...600).contains(readinessTTL) else {
            throw RuntimeControllerError.invalidConfiguration
        }
        self.runtime = runtime
        self.challengeStore = challengeStore
        self.trustedWorkspaceURL = trustedWorkspaceURL
        self.deviceId = deviceId
        self.runtimeIdentity = runtimeIdentity
        self.runtimeVersion = runtimeVersion
        self.readinessTTL = readinessTTL
        self.clock = clock
        self.fileHasher = fileHasher ?? { url in
            try await Task.detached(priority: .utility) {
                try Self.sha256File(url)
            }.value
        }
    }

    @discardableResult
    public func load(model: ModelDescriptor, expectedFileHash: String, estimatedMemoryMB: Int) async throws -> ModelReport {
        try LlamaEngineSupport.validateModel(model)
        guard estimatedMemoryMB > 0, Self.validSHA256(expectedFileHash) else { throw RuntimeControllerError.invalidConfiguration }
        let url = URL(fileURLWithPath: model.path)
        let before = try fileIdentity(url)
        let beforeHash = try Self.sha256File(url)
        guard beforeHash == expectedFileHash.lowercased() else {
            throw RuntimeControllerError.modelHashMismatch
        }
        let lease = try await runtime.acquire(model: model, estimatedMemoryMB: estimatedMemoryMB)
        do {
            let after = try fileIdentity(url)
            guard before == after else { throw RuntimeControllerError.modelFileChanged }
            let afterHash = try Self.sha256File(url)
            guard afterHash == beforeHash else { throw RuntimeControllerError.modelFileChanged }
            let afterHashIdentity = try fileIdentity(url)
            guard after == afterHashIdentity else { throw RuntimeControllerError.modelFileChanged }
            guard sessions[lease.session.id] == nil else { throw RuntimeControllerError.duplicateSession }
            sessions[lease.session.id] = ActiveSession(
                lease: lease,
                fileHash: afterHash,
                fileIdentity: afterHashIdentity,
                readiness: nil,
                readinessTaskId: nil,
                readinessTask: nil,
                generations: [:]
            )
            return report(for: lease.session.id, now: clock())
        } catch {
            _ = await runtime.release(lease)
            _ = await runtime.unloadIdleModels()
            throw error
        }
    }

    /// Performs a real one-token generation through the exact loaded lease.
    /// A successful file import, model load, or health endpoint alone is not readiness.
    @discardableResult
    public func readiness(sessionId: String) async throws -> ModelReport {
        guard !unloadingSessions.contains(sessionId),
              var active = sessions[sessionId] else { throw RuntimeControllerError.unknownSession }
        guard active.readinessTaskId == nil else { throw RuntimeControllerError.duplicateRequest }

        // Reserve the readiness attempt before verifyFile suspends. Actor
        // reentrancy must not allow a second caller to pass the same nil check.
        let token = UUID().uuidString
        active.readiness = nil
        active.readinessTaskId = token
        active.readinessTask = nil
        sessions[sessionId] = active

        do {
            try await verifyFile(active)
            try Task.checkCancellation()
        } catch {
            if var latest = sessions[sessionId], latest.readinessTaskId == token {
                latest.readiness = nil
                latest.readinessTaskId = nil
                latest.readinessTask = nil
                sessions[sessionId] = latest
            }
            throw error
        }

        // verifyFile awaits an off-actor hash. Unload may have removed and
        // released this session while hashing; never start a stale probe.
        guard !unloadingSessions.contains(sessionId),
              var latest = sessions[sessionId],
              latest.lease.session.id == sessionId,
              latest.readinessTaskId == token else {
            throw RuntimeControllerError.unknownSession
        }

        let lease = latest.lease
        let runtime = self.runtime
        let request = GenerationRequest(
            prompt: "Pocket AI Lab native runtime readiness probe. Return one token.",
            maxTokens: 1,
            temperature: 0
        )
        let task = Task { try await runtime.generate(lease: lease, request: request, maxOutputBytes: 256) }
        latest.readinessTask = task
        sessions[sessionId] = latest

        do {
            let output = try await withTaskCancellationHandler {
                try await task.value
            } onCancel: {
                task.cancel()
            }
            try Task.checkCancellation()
            guard !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw RuntimeControllerError.emptyGeneration
            }
            guard !unloadingSessions.contains(sessionId),
                  var completed = sessions[sessionId],
                  completed.readinessTaskId == token else {
                throw RuntimeControllerError.unknownSession
            }
            let checkedAt = clock()
            completed.readiness = Readiness(
                healthCheckId: UUID().uuidString,
                checkedAt: checkedAt,
                expiresAt: checkedAt.addingTimeInterval(readinessTTL)
            )
            completed.readinessTaskId = nil
            completed.readinessTask = nil
            sessions[sessionId] = completed
            return report(for: sessionId, now: checkedAt)
        } catch {
            if var current = sessions[sessionId], current.readinessTaskId == token {
                current.readinessTaskId = nil
                current.readinessTask = nil
                current.readiness = nil
                sessions[sessionId] = current
            }
            throw error
        }
    }

    public func generate(
        sessionId: String,
        prompt: String,
        requestId: String,
        conversationRequestId: String,
        attemptId: String,
        challengeNonce: String,
        pageURL: URL,
        maxTokens: Int = 512,
        temperature: Double = 0.2,
        maxOutputBytes: Int = 64_000
    ) async throws -> RuntimeGenerationRecord {
        guard generationDrainCount == 0 else { throw CancellationError() }
        let requestLifecycle = generationLifecycle
        guard !unloadingSessions.contains(sessionId),
              var active = sessions[sessionId] else { throw RuntimeControllerError.unknownSession }
        let now = clock()
        guard let readiness = active.readiness, readiness.expiresAt > now else {
            throw RuntimeControllerError.notReady
        }
        guard Self.validUUID(requestId),
              Self.validToken(conversationRequestId, maxBytes: 128),
              Self.validToken(attemptId, maxBytes: 128),
              Self.validToken(challengeNonce, minBytes: 16, maxBytes: 128),
              !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              prompt.utf8.count <= 32_768 else {
            throw RuntimeControllerError.invalidRequest
        }
        do { try await verifyFile(active) }
        catch {
            active.readiness = nil
            sessions[sessionId] = active
            throw error
        }
        try Task.checkCancellation()
        guard generationLifecycle == requestLifecycle, generationDrainCount == 0 else {
            throw CancellationError()
        }
        guard (1...1_048_576).contains(maxOutputBytes) else {
            throw RuntimeControllerError.invalidRequest
        }
        guard active.generations[requestId] == nil else {
            throw RuntimeControllerError.duplicateRequest
        }
        let request = GenerationRequest(
            requestId: requestId,
            prompt: prompt,
            maxTokens: maxTokens,
            temperature: temperature
        )
        do { try LlamaEngineSupport.validateRequest(request) }
        catch { throw RuntimeControllerError.invalidRequest }

        // A nonce-shaped string is not authorization. Consume a host-issued,
        // origin/request/session-bound challenge exactly once before inference.
        let challengeAccepted = await challengeStore.consume(
            challengeNonce,
            page: pageURL,
            trusted: trustedWorkspaceURL,
            requestId: requestId,
            sessionId: sessionId
        )
        guard challengeAccepted else { throw RuntimeControllerError.unauthorizedChallenge }
        // Cancellation or navigation can arrive while challenge consumption is
        // suspended, before this request has an inference Task in generations.
        try Task.checkCancellation()
        guard generationLifecycle == requestLifecycle, generationDrainCount == 0 else {
            throw CancellationError()
        }

        // Actor methods are reentrant across the challenge-store await above.
        // A concurrent disconnect/unload may have released this lease while
        // authorization was being consumed. Revalidate the exact session and
        // readiness snapshot before starting inference; never use the stale
        // ActiveSession captured before suspension.
        guard !unloadingSessions.contains(sessionId),
              let beforeRehash = sessions[sessionId],
              beforeRehash.lease.session.id == sessionId,
              let beforeRehashReadiness = beforeRehash.readiness,
              beforeRehashReadiness.healthCheckId == readiness.healthCheckId,
              beforeRehashReadiness.expiresAt > clock(),
              beforeRehash.generations[requestId] == nil else {
            throw RuntimeControllerError.unknownSession
        }

        // Challenge consumption is an asynchronous suspension point. Re-hash
        // after it as well, so a model-file change during authorization cannot
        // pass the pre-challenge check and proceed to inference.
        do {
            try await verifyFile(beforeRehash)
        } catch {
            if var current = sessions[sessionId],
               current.readiness?.healthCheckId == readiness.healthCheckId {
                current.readiness = nil
                sessions[sessionId] = current
            }
            throw error
        }
        try Task.checkCancellation()

        guard generationLifecycle == requestLifecycle, generationDrainCount == 0 else {
            throw CancellationError()
        }

        // verifyFile itself awaits an off-actor hash. Revalidate session and
        // readiness once more after that suspension before starting inference.
        guard !unloadingSessions.contains(sessionId),
              var latest = sessions[sessionId],
              latest.lease.session.id == sessionId,
              let currentReadiness = latest.readiness,
              currentReadiness.healthCheckId == readiness.healthCheckId,
              currentReadiness.expiresAt > clock(),
              latest.generations[requestId] == nil else {
            throw RuntimeControllerError.unknownSession
        }

        let lease = latest.lease
        let runtime = self.runtime
        let task = Task { try await runtime.generate(lease: lease, request: request, maxOutputBytes: maxOutputBytes) }
        latest.generations[requestId] = task
        sessions[sessionId] = latest

        do {
            let output = try await withTaskCancellationHandler {
                try await task.value
            } onCancel: {
                task.cancel()
            }
            if task.isCancelled { throw CancellationError() }
            try Task.checkCancellation()
            guard !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw RuntimeControllerError.emptyGeneration
            }
            guard !unloadingSessions.contains(sessionId), sessions[sessionId] != nil else {
                throw RuntimeControllerError.unknownSession
            }
            clearGeneration(sessionId: sessionId, requestId: requestId)
            return RuntimeGenerationRecord(
                requestId: requestId,
                conversationRequestId: conversationRequestId,
                attemptId: attemptId,
                modelId: lease.model.id,
                modelFileHash: latest.fileHash,
                runtimeSessionId: lease.session.id,
                runtimeVersion: runtimeVersion,
                deviceId: deviceId,
                runtimeIdentity: runtimeIdentity,
                challengeNonce: challengeNonce,
                generationResultHash: Self.sha256(Data(output.utf8)),
                generatedAt: clock(),
                healthCheckId: currentReadiness.healthCheckId,
                output: output
            )
        } catch {
            clearGeneration(sessionId: sessionId, requestId: requestId)
            throw error
        }
    }

    /// Cancels the matching request and waits for the native runtime's drain path.
    @discardableResult
    public func cancelGeneration(sessionId: String, requestId: String) async -> Bool {
        guard let task = sessions[sessionId]?.generations[requestId] else { return false }
        task.cancel()
        _ = try? await task.value
        clearGeneration(sessionId: sessionId, requestId: requestId)
        return true
    }

    /// Cancels every active generation and awaits each runtime cancellation
    /// drain. Used when the trusted workspace navigates or is torn down.
    @discardableResult
    public func cancelAllGenerations() async -> Int {
        // Advance before the first await so suspended pre-inference attempts
        // cannot resume and register a native generation after this drain.
        generationLifecycle &+= 1
        generationDrainCount += 1
        defer { generationDrainCount -= 1 }

        let pending = sessions.flatMap { sessionId, active in
            active.generations.keys.map { (sessionId, $0) }
        }
        var cancelled = 0
        for (sessionId, requestId) in pending {
            if await cancelGeneration(sessionId: sessionId, requestId: requestId) {
                cancelled += 1
            }
        }
        return cancelled
    }

    /// Releases one exact session lease. Other consumers' leases are never evicted.
    @discardableResult
    public func unload(sessionId: String) async -> Bool {
        guard sessions[sessionId] != nil, unloadingSessions.insert(sessionId).inserted else { return false }
        defer { unloadingSessions.remove(sessionId) }
        if let readinessTask = sessions[sessionId]?.readinessTask {
            readinessTask.cancel()
            _ = try? await readinessTask.value
        }
        let requestIDs = Array(sessions[sessionId]?.generations.keys ?? Dictionary<String, Task<String, Error>>().keys)
        for requestId in requestIDs {
            _ = await cancelGeneration(sessionId: sessionId, requestId: requestId)
        }
        guard let removed = sessions.removeValue(forKey: sessionId) else { return false }
        _ = await runtime.release(removed.lease)
        _ = await runtime.unloadIdleModels()
        return true
    }

    public func disconnect() async {
        for sessionId in Array(sessions.keys) {
            _ = await unload(sessionId: sessionId)
        }
        _ = await runtime.unloadIdleModels()
    }

    public func reports() -> [ModelReport] {
        let now = clock()
        return sessions.keys.sorted().map { report(for: $0, now: now) }
    }

    private func clearGeneration(sessionId: String, requestId: String) {
        guard var active = sessions[sessionId] else { return }
        active.generations.removeValue(forKey: requestId)
        sessions[sessionId] = active
    }

    private func report(for sessionId: String, now: Date) -> ModelReport {
        guard let active = sessions[sessionId] else {
            return ModelReport(
                id: "",
                phase: "unavailable",
                canGenerate: false,
                sessionId: nil,
                fileHash: nil,
                runtimeVersion: nil,
                healthCheckId: nil,
                expiresAt: nil
            )
        }
        let fileMatches: Bool
        if let current = try? fileIdentity(URL(fileURLWithPath: active.lease.model.path)) {
            fileMatches = current == active.fileIdentity
        } else {
            fileMatches = false
        }
        let ready = fileMatches && (active.readiness.map { $0.expiresAt > now } ?? false)
        return ModelReport(
            id: active.lease.model.id,
            phase: fileMatches ? (ready ? "ready" : "loaded") : "invalidated",
            canGenerate: ready,
            sessionId: sessionId,
            fileHash: active.fileHash,
            runtimeVersion: runtimeVersion,
            healthCheckId: ready ? active.readiness?.healthCheckId : nil,
            expiresAt: ready ? active.readiness?.expiresAt : nil
        )
    }

    private func verifyFile(_ active: ActiveSession) async throws {
        let url = URL(fileURLWithPath: active.lease.model.path)
        let current = try fileIdentity(url)
        guard current == active.fileIdentity else { throw RuntimeControllerError.modelFileChanged }
        // Size and modification time are useful change detectors, but neither
        // proves byte identity. Re-hash before readiness and generation so a
        // same-size rewrite with restored timestamps cannot retain readiness.
        let expectedHash = active.fileHash
        let currentHash = try await fileHasher(url)
        guard currentHash == expectedHash else { throw RuntimeControllerError.modelFileChanged }
    }

    private func fileIdentity(_ url: URL) throws -> ModelFileIdentity {
        let values: URLResourceValues
        do {
            values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey, .contentModificationDateKey])
        } catch {
            throw RuntimeControllerError.modelFileUnavailable
        }
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, size >= 4,
              hasGGUFHeader(url) else {
            throw RuntimeControllerError.modelFileUnavailable
        }
        return ModelFileIdentity(size: Int64(size), modifiedAt: values.contentModificationDate)
    }

    private func hasGGUFHeader(_ url: URL) -> Bool {
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        return (try? handle.read(upToCount: 4)) == Data("GGUF".utf8)
    }

    private static func sha256File(_ url: URL) throws -> String {
        let handle: FileHandle
        do { handle = try FileHandle(forReadingFrom: url) }
        catch { throw RuntimeControllerError.modelFileUnavailable }
        defer { try? handle.close() }
        var hasher = SHA256()
        do {
            while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
                hasher.update(data: chunk)
            }
        } catch {
            throw RuntimeControllerError.modelFileUnavailable
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func validSHA256(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0) || (65...70).contains($0)
        }
    }

    private static func validUUID(_ value: String) -> Bool {
        UUID(uuidString: value) != nil
    }

    private static func validToken(_ value: String, minBytes: Int = 1, maxBytes: Int) -> Bool {
        let bytes = value.utf8
        guard (minBytes...maxBytes).contains(bytes.count) else { return false }
        return bytes.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte) ||
            [45, 46, 95, 58, 43, 47, 61].contains(byte)
        }
    }
}

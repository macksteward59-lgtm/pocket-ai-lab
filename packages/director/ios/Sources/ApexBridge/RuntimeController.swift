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
    case unknownSession
    case notReady
    case invalidRequest
    case duplicateRequest
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
        var generations: [String: Task<String, Error>]
    }

    private let runtime: NativeInferenceRuntime
    public let runtimeVersion: String
    public let deviceId: String
    public let runtimeIdentity: String
    private let readinessTTL: TimeInterval
    private let clock: @Sendable () -> Date
    private var sessions: [String: ActiveSession] = [:]
    private var unloadingSessions: Set<String> = []

    public init(
        runtime: NativeInferenceRuntime,
        deviceId: String,
        runtimeIdentity: String,
        runtimeVersion: String = "pocket-ai-lab-native/1",
        readinessTTL: TimeInterval = 120,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) throws {
        guard !deviceId.isEmpty, deviceId.utf8.count <= 128,
              !runtimeIdentity.isEmpty, runtimeIdentity.utf8.count <= 128,
              !runtimeVersion.isEmpty, runtimeVersion.utf8.count <= 128,
              readinessTTL.isFinite, (1...600).contains(readinessTTL) else {
            throw RuntimeControllerError.invalidConfiguration
        }
        self.runtime = runtime
        self.deviceId = deviceId
        self.runtimeIdentity = runtimeIdentity
        self.runtimeVersion = runtimeVersion
        self.readinessTTL = readinessTTL
        self.clock = clock
    }

    @discardableResult
    public func load(model: ModelDescriptor, estimatedMemoryMB: Int) async throws -> ModelReport {
        try LlamaEngineSupport.validateModel(model)
        guard estimatedMemoryMB > 0 else { throw RuntimeControllerError.invalidConfiguration }
        let url = URL(fileURLWithPath: model.path)
        let before = try fileIdentity(url)
        let lease = try await runtime.acquire(model: model, estimatedMemoryMB: estimatedMemoryMB)
        do {
            let after = try fileIdentity(url)
            guard before == after else { throw RuntimeControllerError.modelFileChanged }
            let hash = try Self.sha256File(url)
            let afterHash = try fileIdentity(url)
            guard after == afterHash else { throw RuntimeControllerError.modelFileChanged }
            sessions[lease.session.id] = ActiveSession(
                lease: lease,
                fileHash: hash,
                fileIdentity: afterHash,
                readiness: nil,
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
        let now = clock()
        do { try verifyFile(active) }
        catch {
            active.readiness = nil
            sessions[sessionId] = active
            throw error
        }
        active.readiness = nil
        sessions[sessionId] = active
        let request = GenerationRequest(
            prompt: "Pocket AI Lab native runtime readiness probe. Return one token.",
            maxTokens: 1,
            temperature: 0
        )
        let output = try await runtime.generate(lease: active.lease, request: request, maxOutputBytes: 256)
        guard !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw RuntimeControllerError.emptyGeneration
        }
        let check = Readiness(
            healthCheckId: UUID().uuidString,
            checkedAt: now,
            expiresAt: now.addingTimeInterval(readinessTTL)
        )
        active.readiness = check
        sessions[sessionId] = active
        return report(for: sessionId, now: now)
    }

    public func generate(
        sessionId: String,
        prompt: String,
        requestId: String,
        conversationRequestId: String,
        attemptId: String,
        challengeNonce: String,
        maxTokens: Int = 512,
        temperature: Double = 0.2,
        maxOutputBytes: Int = 64_000
    ) async throws -> RuntimeGenerationRecord {
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
        do { try verifyFile(active) }
        catch {
            active.readiness = nil
            sessions[sessionId] = active
            throw error
        }
        guard maxOutputBytes > 0, active.generations[requestId] == nil else {
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

        let lease = active.lease
        let runtime = self.runtime
        let task = Task { try await runtime.generate(lease: lease, request: request, maxOutputBytes: maxOutputBytes) }
        active.generations[requestId] = task
        sessions[sessionId] = active

        do {
            let output = try await withTaskCancellationHandler {
                try await task.value
            } onCancel: {
                task.cancel()
            }
            guard !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                throw RuntimeControllerError.emptyGeneration
            }
            clearGeneration(sessionId: sessionId, requestId: requestId)
            return RuntimeGenerationRecord(
                requestId: requestId,
                conversationRequestId: conversationRequestId,
                attemptId: attemptId,
                modelId: lease.model.id,
                modelFileHash: active.fileHash,
                runtimeSessionId: lease.session.id,
                runtimeVersion: runtimeVersion,
                deviceId: deviceId,
                runtimeIdentity: runtimeIdentity,
                challengeNonce: challengeNonce,
                generationResultHash: Self.sha256(Data(output.utf8)),
                generatedAt: now,
                healthCheckId: readiness.healthCheckId,
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

    /// Releases one exact session lease. Other consumers' leases are never evicted.
    @discardableResult
    public func unload(sessionId: String) async -> Bool {
        guard let active = sessions[sessionId], unloadingSessions.insert(sessionId).inserted else { return false }
        defer { unloadingSessions.remove(sessionId) }
        for requestId in Array(active.generations.keys) {
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
        let ready = active.readiness.map { $0.expiresAt > now } ?? false
        return ModelReport(
            id: active.lease.model.id,
            phase: ready ? "ready" : "loaded",
            canGenerate: ready,
            sessionId: sessionId,
            fileHash: active.fileHash,
            runtimeVersion: runtimeVersion,
            healthCheckId: ready ? active.readiness?.healthCheckId : nil,
            expiresAt: ready ? active.readiness?.expiresAt : nil
        )
    }

    private func verifyFile(_ active: ActiveSession) throws {
        let current = try fileIdentity(URL(fileURLWithPath: active.lease.model.path))
        guard current == active.fileIdentity else { throw RuntimeControllerError.modelFileChanged }
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

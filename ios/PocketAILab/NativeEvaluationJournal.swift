import CryptoKit
import Foundation

enum NativeEvaluationJournalError: Error, Equatable {
    case invalidAttempt(String)
    case invalidAssessment(String)
    case invalidChallenge(String)
    case missingAttempt(String)
    case assessmentMustUseSeparateRuntimeSession
    case corruptJournal(String)
}

/// A complete output record is kept locally, including failures and partial output.
/// No delete, truncate, replace, or retention-expiry operation is exposed.
struct NativeEvaluationAttempt: Codable, Equatable, Identifiable {
    let id: String
    let suiteID: String
    let suiteVersion: String
    let caseID: String
    let attemptNumber: Int
    let retryOfAttemptID: String?
    let modelID: String
    let modelArtifactSHA256: String
    let runtimeSessionID: String
    let requestID: String
    let prompt: String
    let output: String
    let status: Status
    let providerKind: ProviderKind
    let nativeExecutionObserved: Bool
    let runtimeTrustVerified: Bool
    let errorMessage: String?
    let startedAt: Date
    let completedAt: Date
    let latencyMilliseconds: Int
    let maxTokens: Int

    enum Status: String, Codable { case completed, partial, failed }
    enum ProviderKind: String, Codable { case llamaCppBackend, unverifiedProvider }
}

struct NativeEvaluationAttemptDraft {
    let id: String
    let suiteID: String
    let suiteVersion: String
    let caseID: String
    let modelID: String
    let modelArtifactSHA256: String
    let runtimeSessionID: String
    let requestID: String
    let prompt: String
    let output: String
    let status: NativeEvaluationAttempt.Status
    let providerKind: NativeEvaluationAttempt.ProviderKind
    let nativeExecutionObserved: Bool
    let errorMessage: String?
    let startedAt: Date
    let completedAt: Date
    let latencyMilliseconds: Int
    let maxTokens: Int
}

struct NativeEvaluationAssessment: Codable, Equatable, Identifiable {
    let id: String
    let attemptID: String
    let evaluatorRole: EvaluatorRole
    let evaluatorAgentID: String
    let evaluatorModelID: String
    let evaluatorRuntimeSessionID: String
    let rubricVersion: String
    let score: Double
    let passed: Bool
    let rationale: String
    let assessedAt: Date

    enum EvaluatorRole: String, Codable { case critic, validator }
}

struct NativeEvaluationChallenge: Codable, Equatable, Identifiable {
    let id: String
    let attemptID: String
    let authorAgentID: String
    let reason: String
    let submittedAt: Date
}

struct NativeEvaluationJournalPayload: Codable, Equatable {
    let kind: Kind
    let attempt: NativeEvaluationAttempt?
    let assessment: NativeEvaluationAssessment?
    let challenge: NativeEvaluationChallenge?

    enum Kind: String, Codable { case attempt, assessment, challenge }
}

struct NativeEvaluationJournalEvent: Codable, Equatable, Identifiable {
    let id: String
    let sequence: Int
    let previousHash: String
    let eventHash: String
    let payload: NativeEvaluationJournalPayload
}

/// Hash-chained, append-only local journal. A changed, reordered, or removed
/// event causes reads and subsequent writes to fail closed.
actor NativeEvaluationJournal {
    private static let genesis = "GENESIS"
    private let fileURL: URL
    private var lastSequence: Int
    private var lastHash: String

    init(fileURL: URL) throws {
        self.fileURL = fileURL
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if !FileManager.default.fileExists(atPath: fileURL.path) {
            guard FileManager.default.createFile(atPath: fileURL.path, contents: Data()) else {
                throw NativeEvaluationJournalError.corruptJournal("Could not create journal file.")
            }
        }
        #if os(iOS)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: fileURL.path
        )
        #endif
        let events = try Self.readAndVerify(fileURL: fileURL)
        lastSequence = events.last?.sequence ?? 0
        lastHash = events.last?.eventHash ?? Self.genesis
    }

    static func applicationDefault() throws -> NativeEvaluationJournal {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PocketAILab", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        #if os(iOS)
        try FileManager.default.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: root.path
        )
        #endif
        return try NativeEvaluationJournal(
            fileURL: root.appendingPathComponent("native-evaluation-history.ndjson")
        )
    }

    func appendAttempt(_ draft: NativeEvaluationAttemptDraft) throws -> NativeEvaluationAttempt {
        guard !draft.id.isEmpty, !draft.suiteID.isEmpty, !draft.suiteVersion.isEmpty,
              !draft.caseID.isEmpty, !draft.modelID.isEmpty, !draft.runtimeSessionID.isEmpty,
              !draft.requestID.isEmpty, !draft.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              draft.modelArtifactSHA256.count == 64,
              draft.modelArtifactSHA256.allSatisfy({ $0.isHexDigit }),
              draft.maxTokens > 0, draft.latencyMilliseconds >= 0 else {
            throw NativeEvaluationJournalError.invalidAttempt("Required metadata, SHA-256 fingerprint, or generation bounds are invalid.")
        }
        try verifyDiskState()
        let prior = try Self.readAndVerify(fileURL: fileURL).compactMap(\.payload.attempt)
            .last { $0.suiteID == draft.suiteID && $0.caseID == draft.caseID &&
                    $0.modelID == draft.modelID && $0.modelArtifactSHA256 == draft.modelArtifactSHA256 }
        let attempt = NativeEvaluationAttempt(
            id: draft.id, suiteID: draft.suiteID, suiteVersion: draft.suiteVersion,
            caseID: draft.caseID, attemptNumber: (prior?.attemptNumber ?? 0) + 1,
            retryOfAttemptID: prior?.id, modelID: draft.modelID,
            modelArtifactSHA256: draft.modelArtifactSHA256, runtimeSessionID: draft.runtimeSessionID,
            requestID: draft.requestID, prompt: draft.prompt, output: draft.output,
            status: draft.status, providerKind: draft.providerKind,
            nativeExecutionObserved: draft.nativeExecutionObserved, runtimeTrustVerified: false,
            errorMessage: draft.errorMessage, startedAt: draft.startedAt, completedAt: draft.completedAt,
            latencyMilliseconds: draft.latencyMilliseconds, maxTokens: draft.maxTokens
        )
        _ = try append(.init(kind: .attempt, attempt: attempt, assessment: nil, challenge: nil))
        return attempt
    }

    func appendAssessment(_ assessment: NativeEvaluationAssessment) throws {
        guard !assessment.id.isEmpty, !assessment.evaluatorAgentID.isEmpty,
              !assessment.evaluatorModelID.isEmpty, !assessment.evaluatorRuntimeSessionID.isEmpty,
              !assessment.rubricVersion.isEmpty, !assessment.rationale.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              assessment.score.isFinite, (0...1).contains(assessment.score) else {
            throw NativeEvaluationJournalError.invalidAssessment("Assessment metadata, rationale, or score is invalid.")
        }
        try verifyDiskState()
        let attempts = try Self.readAndVerify(fileURL: fileURL).compactMap(\.payload.attempt)
        guard let target = attempts.first(where: { $0.id == assessment.attemptID }) else {
            throw NativeEvaluationJournalError.missingAttempt(assessment.attemptID)
        }
        guard target.runtimeSessionID != assessment.evaluatorRuntimeSessionID else {
            throw NativeEvaluationJournalError.assessmentMustUseSeparateRuntimeSession
        }
        _ = try append(.init(kind: .assessment, attempt: nil, assessment: assessment, challenge: nil))
    }

    func appendChallenge(_ challenge: NativeEvaluationChallenge) throws {
        guard !challenge.id.isEmpty, !challenge.authorAgentID.isEmpty,
              !challenge.reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw NativeEvaluationJournalError.invalidChallenge("Challenge must identify its author and rationale.")
        }
        try verifyDiskState()
        let attempts = try Self.readAndVerify(fileURL: fileURL).compactMap(\.payload.attempt)
        guard attempts.contains(where: { $0.id == challenge.attemptID }) else {
            throw NativeEvaluationJournalError.missingAttempt(challenge.attemptID)
        }
        _ = try append(.init(kind: .challenge, attempt: nil, assessment: nil, challenge: challenge))
    }

    func events() throws -> [NativeEvaluationJournalEvent] {
        try Self.readAndVerify(fileURL: fileURL)
    }

    private func append(_ payload: NativeEvaluationJournalPayload) throws -> NativeEvaluationJournalEvent {
        try verifyDiskState()
        let nextSequence = lastSequence + 1
        let eventID = UUID().uuidString
        let hash = try Self.hash(sequence: nextSequence, eventID: eventID, previousHash: lastHash, payload: payload)
        let event = NativeEvaluationJournalEvent(
            id: eventID, sequence: nextSequence, previousHash: lastHash,
            eventHash: hash, payload: payload
        )
        var line = try Self.encoder().encode(event)
        line.append(0x0A)
        let handle = try FileHandle(forWritingTo: fileURL)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
        try handle.synchronize()
        lastSequence = nextSequence
        lastHash = hash
        return event
    }

    private func verifyDiskState() throws {
        let events = try Self.readAndVerify(fileURL: fileURL)
        let diskSequence = events.last?.sequence ?? 0
        let diskHash = events.last?.eventHash ?? Self.genesis
        guard diskSequence == lastSequence, diskHash == lastHash else {
            throw NativeEvaluationJournalError.corruptJournal("Journal changed outside the append-only writer.")
        }
    }

    private static func readAndVerify(fileURL: URL) throws -> [NativeEvaluationJournalEvent] {
        let data = try Data(contentsOf: fileURL)
        if data.isEmpty { return [] }
        guard data.last == 0x0A else {
            throw NativeEvaluationJournalError.corruptJournal("Journal ends with an incomplete record.")
        }
        let lines = data.split(separator: 0x0A, omittingEmptySubsequences: true)
        var previous = genesis
        var verified: [NativeEvaluationJournalEvent] = []
        for (offset, line) in lines.enumerated() {
            let event: NativeEvaluationJournalEvent
            do {
                event = try JSONDecoder().decode(NativeEvaluationJournalEvent.self, from: Data(line))
            } catch {
                throw NativeEvaluationJournalError.corruptJournal("Record \(offset + 1) cannot be decoded.")
            }
            let expected = try hash(sequence: offset + 1, eventID: event.id, previousHash: previous, payload: event.payload)
            guard event.sequence == offset + 1, event.previousHash == previous, event.eventHash == expected else {
                throw NativeEvaluationJournalError.corruptJournal("Hash-chain verification failed at record \(offset + 1).")
            }
            previous = event.eventHash
            verified.append(event)
        }
        return verified
    }

    private static func hash(sequence: Int, eventID: String, previousHash: String, payload: NativeEvaluationJournalPayload) throws -> String {
        let payloadData = try encoder().encode(payload)
        var material = Data("\(sequence)\n\(eventID)\n\(previousHash)\n".utf8)
        material.append(payloadData)
        return SHA256.hash(data: material).map { String(format: "%02x", $0) }.joined()
    }

    private static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}

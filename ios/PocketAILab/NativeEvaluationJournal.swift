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
enum NativeEvaluationScoringRule: String, Codable {
    case exactMatch
    case manualReview
}

struct NativeEvaluationAttempt: Codable, Equatable, Identifiable {
    let id: String
    let category: NativeEvaluationCategory
    let suiteID: String
    let suiteVersion: String
    let caseID: String
    let evaluationCriteria: String
    let expectedOutcome: String
    let scoringRule: NativeEvaluationScoringRule
    let deterministicPassed: Bool?
    let deterministicScore: Double?
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
    let estimatedMemoryMB: Int
    let promptUTF8Bytes: Int
    let outputUTF8Bytes: Int

    enum Status: String, Codable { case completed, partial, failed }
    enum ProviderKind: String, Codable { case llamaCppBackend, unverifiedProvider }
}

struct NativeEvaluationAttemptDraft {
    let id: String
    let category: NativeEvaluationCategory
    let suiteID: String
    let suiteVersion: String
    let caseID: String
    let evaluationCriteria: String
    let expectedOutcome: String
    let scoringRule: NativeEvaluationScoringRule
    let deterministicPassed: Bool?
    let deterministicScore: Double?
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
    let estimatedMemoryMB: Int
    let promptUTF8Bytes: Int
    let outputUTF8Bytes: Int
}

enum NativeEvaluationCategory: String, Codable, CaseIterable {
    case reasoningProblemSolving
    case factualAccuracyEvidence
    case codingEngineering
    case taskCompletion
    case collaboration
    case memoryRetention
    case securityPolicyCompliance
    case runtimeEfficiencyReliability
}

struct NativeEvaluationCategoryScore: Codable, Equatable {
    let category: NativeEvaluationCategory
    let score: Double
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
    let categoryScores: [NativeEvaluationCategoryScore]
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
              !draft.caseID.isEmpty, !draft.evaluationCriteria.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !draft.modelID.isEmpty, !draft.runtimeSessionID.isEmpty,
              !draft.requestID.isEmpty, !draft.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              draft.modelArtifactSHA256.count == 64,
              draft.modelArtifactSHA256.allSatisfy({ $0.isHexDigit }),
              draft.maxTokens > 0, draft.latencyMilliseconds >= 0, draft.estimatedMemoryMB > 0,
              draft.promptUTF8Bytes == draft.prompt.utf8.count, draft.outputUTF8Bytes == draft.output.utf8.count,
              !draft.nativeExecutionObserved || (draft.providerKind == .llamaCppBackend && draft.status == .completed),
              Self.validDeterministicScore(rule: draft.scoringRule, passed: draft.deterministicPassed, score: draft.deterministicScore) else {
            throw NativeEvaluationJournalError.invalidAttempt("Required metadata, SHA-256 fingerprint, or generation bounds are invalid.")
        }
        try verifyDiskState()
        let existingAttempts = try Self.readAndVerify(fileURL: fileURL).compactMap(\.payload.attempt)
        guard !existingAttempts.contains(where: { $0.id == draft.id }) else {
            throw NativeEvaluationJournalError.invalidAttempt("Attempt ID already exists.")
        }
        let prior = existingAttempts
            .last { $0.suiteID == draft.suiteID && $0.suiteVersion == draft.suiteVersion && $0.caseID == draft.caseID &&
                    $0.modelID == draft.modelID && $0.modelArtifactSHA256 == draft.modelArtifactSHA256 }
        let attempt = NativeEvaluationAttempt(
            id: draft.id, category: draft.category, suiteID: draft.suiteID, suiteVersion: draft.suiteVersion,
            caseID: draft.caseID, evaluationCriteria: draft.evaluationCriteria,
            expectedOutcome: draft.expectedOutcome, scoringRule: draft.scoringRule,
            deterministicPassed: draft.deterministicPassed, deterministicScore: draft.deterministicScore,
            attemptNumber: (prior?.attemptNumber ?? 0) + 1,
            retryOfAttemptID: prior?.id, modelID: draft.modelID,
            modelArtifactSHA256: draft.modelArtifactSHA256, runtimeSessionID: draft.runtimeSessionID,
            requestID: draft.requestID, prompt: draft.prompt, output: draft.output,
            status: draft.status, providerKind: draft.providerKind,
            nativeExecutionObserved: draft.nativeExecutionObserved, runtimeTrustVerified: false,
            errorMessage: draft.errorMessage, startedAt: draft.startedAt, completedAt: draft.completedAt,
            latencyMilliseconds: draft.latencyMilliseconds, maxTokens: draft.maxTokens,
            estimatedMemoryMB: draft.estimatedMemoryMB, promptUTF8Bytes: draft.promptUTF8Bytes,
            outputUTF8Bytes: draft.outputUTF8Bytes
        )
        _ = try append(.init(kind: .attempt, attempt: attempt, assessment: nil, challenge: nil))
        return attempt
    }

    func appendAssessment(_ assessment: NativeEvaluationAssessment) throws {
        guard !assessment.id.isEmpty, !assessment.evaluatorAgentID.isEmpty,
              !assessment.evaluatorModelID.isEmpty, !assessment.evaluatorRuntimeSessionID.isEmpty,
              !assessment.rubricVersion.isEmpty, !assessment.rationale.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              assessment.evaluatorAgentID.lowercased() == assessment.evaluatorRole.rawValue,
              assessment.score.isFinite, (0...1).contains(assessment.score),
              Self.hasCompleteCategoryScores(assessment.categoryScores) else {
            throw NativeEvaluationJournalError.invalidAssessment("Assessment metadata, rationale, or score is invalid.")
        }
        try verifyDiskState()
        let existingEvents = try Self.readAndVerify(fileURL: fileURL)
        guard !existingEvents.compactMap(\.payload.assessment).contains(where: { $0.id == assessment.id }) else {
            throw NativeEvaluationJournalError.invalidAssessment("Assessment ID already exists.")
        }
        let attempts = existingEvents.compactMap(\.payload.attempt)
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
        let existingEvents = try Self.readAndVerify(fileURL: fileURL)
        guard !existingEvents.compactMap(\.payload.challenge).contains(where: { $0.id == challenge.id }) else {
            throw NativeEvaluationJournalError.invalidChallenge("Challenge ID already exists.")
        }
        let attempts = existingEvents.compactMap(\.payload.attempt)
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
        let components = data.split(separator: 0x0A, omittingEmptySubsequences: false)
        guard components.last?.isEmpty == true else {
            throw NativeEvaluationJournalError.corruptJournal("Journal must end with exactly one record delimiter.")
        }
        let lines = components.dropLast()
        guard lines.allSatisfy({ !$0.isEmpty }) else {
            throw NativeEvaluationJournalError.corruptJournal("Journal contains an empty record.")
        }
        var previous = genesis
        var verified: [NativeEvaluationJournalEvent] = []
        var attemptsByID: [String: NativeEvaluationAttempt] = [:]
        var assessmentIDs = Set<String>()
        var challengeIDs = Set<String>()
        for (offset, line) in lines.enumerated() {
            let event: NativeEvaluationJournalEvent
            do {
                event = try JSONDecoder().decode(NativeEvaluationJournalEvent.self, from: Data(line))
            } catch {
                throw NativeEvaluationJournalError.corruptJournal("Record \(offset + 1) cannot be decoded.")
            }
            let expected = try hash(sequence: offset + 1, eventID: event.id, previousHash: previous, payload: event.payload)
            guard !event.id.isEmpty, event.sequence == offset + 1,
                  event.previousHash == previous, event.eventHash == expected else {
                throw NativeEvaluationJournalError.corruptJournal("Hash-chain verification failed at record \(offset + 1).")
            }
            switch event.payload.kind {
            case .attempt:
                guard let attempt = event.payload.attempt,
                      event.payload.assessment == nil, event.payload.challenge == nil,
                      Self.validAttempt(attempt),
                      attemptsByID[attempt.id] == nil else {
                    throw NativeEvaluationJournalError.corruptJournal("Attempt event has an invalid or duplicate payload.")
                }
                attemptsByID[attempt.id] = attempt
            case .assessment:
                guard let assessment = event.payload.assessment,
                      event.payload.attempt == nil, event.payload.challenge == nil,
                      !assessment.id.isEmpty, assessmentIDs.insert(assessment.id).inserted,
                      let target = attemptsByID[assessment.attemptID],
                      target.runtimeSessionID != assessment.evaluatorRuntimeSessionID,
                      assessment.evaluatorAgentID.lowercased() == assessment.evaluatorRole.rawValue,
                      assessment.score.isFinite, (0...1).contains(assessment.score),
                      Self.hasCompleteCategoryScores(assessment.categoryScores) else {
                    throw NativeEvaluationJournalError.corruptJournal("Assessment event is invalid or references no prior attempt.")
                }
            case .challenge:
                guard let challenge = event.payload.challenge,
                      event.payload.attempt == nil, event.payload.assessment == nil,
                      !challenge.id.isEmpty, challengeIDs.insert(challenge.id).inserted,
                      attemptsByID[challenge.attemptID] != nil else {
                    throw NativeEvaluationJournalError.corruptJournal("Challenge event is invalid or references no prior attempt.")
                }
            }
            previous = event.eventHash
            verified.append(event)
        }
        return verified
    }

    private static func validAttempt(_ attempt: NativeEvaluationAttempt) -> Bool {
        guard !attempt.id.isEmpty, !attempt.suiteID.isEmpty, !attempt.suiteVersion.isEmpty,
              !attempt.caseID.isEmpty, !attempt.evaluationCriteria.isEmpty,
              !attempt.modelID.isEmpty, !attempt.runtimeSessionID.isEmpty, !attempt.requestID.isEmpty,
              !attempt.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              attempt.modelArtifactSHA256.count == 64,
              attempt.modelArtifactSHA256.allSatisfy({ $0.isHexDigit }),
              attempt.maxTokens > 0, attempt.latencyMilliseconds >= 0, attempt.estimatedMemoryMB > 0,
              attempt.promptUTF8Bytes == attempt.prompt.utf8.count,
              attempt.outputUTF8Bytes == attempt.output.utf8.count,
              !attempt.runtimeTrustVerified,
              !attempt.nativeExecutionObserved || (attempt.providerKind == .llamaCppBackend && attempt.status == .completed) else {
            return false
        }
        return validDeterministicScore(rule: attempt.scoringRule, passed: attempt.deterministicPassed, score: attempt.deterministicScore)
    }

    private static func hasCompleteCategoryScores, attempt.latencyMilliseconds >= 0, attempt.estimatedMemoryMB > 0,
                      attempt.promptUTF8Bytes == attempt.prompt.utf8.count,
                      attempt.outputUTF8Bytes == attempt.output.utf8.count,
                      Self.validDeterministicScore(rule: attempt.scoringRule, passed: attempt.deterministicPassed, score: attempt.deterministicScore),
                      attemptsByID[attempt.id] == nil else {
                    throw NativeEvaluationJournalError.corruptJournal("Attempt event has an invalid or duplicate payload.")
                }
                attemptsByID[attempt.id] = attempt
            case .assessment:
                guard let assessment = event.payload.assessment,
                      event.payload.attempt == nil, event.payload.challenge == nil,
                      !assessment.id.isEmpty, assessmentIDs.insert(assessment.id).inserted,
                      let target = attemptsByID[assessment.attemptID],
                      target.runtimeSessionID != assessment.evaluatorRuntimeSessionID,
                      assessment.evaluatorAgentID.lowercased() == assessment.evaluatorRole.rawValue,
                      assessment.score.isFinite, (0...1).contains(assessment.score),
                      Self.hasCompleteCategoryScores(assessment.categoryScores) else {
                    throw NativeEvaluationJournalError.corruptJournal("Assessment event is invalid or references no prior attempt.")
                }
            case .challenge:
                guard let challenge = event.payload.challenge,
                      event.payload.attempt == nil, event.payload.assessment == nil,
                      !challenge.id.isEmpty, challengeIDs.insert(challenge.id).inserted,
                      attemptsByID[challenge.attemptID] != nil else {
                    throw NativeEvaluationJournalError.corruptJournal("Challenge event is invalid or references no prior attempt.")
                }
            }
            previous = event.eventHash
            verified.append(event)
        }
        return verified
    }

    private static func validDeterministicScore(rule: NativeEvaluationScoringRule, passed: Bool?, score: Double?) -> Bool {
        switch rule {
        case .manualReview:
            return passed == nil && score == nil
        case .exactMatch:
            guard let passed, let score, score.isFinite else { return false }
            return score == (passed ? 1.0 : 0.0)
        }
    }

    private static func hasCompleteCategoryScores(_ scores: [NativeEvaluationCategoryScore]) -> Bool {
        let categories = scores.map(\.category)
        return Set(categories).count == NativeEvaluationCategory.allCases.count &&
            Set(categories) == Set(NativeEvaluationCategory.allCases) &&
            scores.allSatisfy { $0.score.isFinite && (0...1).contains($0.score) }
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

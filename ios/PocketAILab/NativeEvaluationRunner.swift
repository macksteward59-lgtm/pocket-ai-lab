import CryptoKit
import Foundation
import PocketLlamaEngine

struct NativeEvaluationCase: Sendable {
    let suiteID: String
    let suiteVersion: String
    let caseID: String
    let prompt: String
    let evaluationCriteria: String
    let expectedOutcome: String
    let maxTokens: Int
    let temperature: Double

    init(suiteID: String, suiteVersion: String, caseID: String, prompt: String, evaluationCriteria: String,
         expectedOutcome: String = "", maxTokens: Int = 256, temperature: Double = 0) {
        self.suiteID = suiteID
        self.suiteVersion = suiteVersion
        self.caseID = caseID
        self.prompt = prompt
        self.evaluationCriteria = evaluationCriteria
        self.expectedOutcome = expectedOutcome
        self.maxTokens = maxTokens
        self.temperature = temperature
    }
}

/// Executes benchmark cases through the app's injected native inference boundary.
/// The model fingerprint is calculated from the actual file and checked both
/// before and after inference. Only a successful non-empty generation from
/// LlamaCppMetalBackend is recorded as observed native execution. This is not
/// signed runtime attestation and never grants APEX/East authority.
struct NativeEvaluationRunner: Sendable {
    private let engine: any LlamaEngine
    private let journal: NativeEvaluationJournal
    private let modelFileURL: URL
    private let modelArtifactSHA256: String

    init(engine: any LlamaEngine, journal: NativeEvaluationJournal, modelFileURL: URL) throws {
        self.engine = engine
        self.journal = journal
        self.modelFileURL = modelFileURL
        self.modelArtifactSHA256 = try Self.sha256(fileURL: modelFileURL)
    }

    func run(_ evaluationCase: NativeEvaluationCase, session: RuntimeSession) async throws -> NativeEvaluationAttempt {
        guard !evaluationCase.suiteID.isEmpty, !evaluationCase.suiteVersion.isEmpty,
              !evaluationCase.caseID.isEmpty,
              !evaluationCase.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !evaluationCase.evaluationCriteria.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              evaluationCase.maxTokens > 0, evaluationCase.maxTokens <= 4096,
              evaluationCase.temperature.isFinite,
              (0...2).contains(evaluationCase.temperature),
              !session.id.isEmpty, !session.modelId.isEmpty else {
            throw NativeEvaluationJournalError.invalidAttempt("Evaluation case or runtime session metadata is invalid.")
        }

        let requestID = UUID().uuidString
        let startedAt = Date()
        var output = ""
        var failure: String?

        do {
            let currentHash = try Self.sha256(fileURL: modelFileURL)
            guard currentHash == modelArtifactSHA256 else {
                throw NativeEvaluationJournalError.invalidAttempt("Model file changed after the evaluation runner was initialized.")
            }
        } catch {
            failure = "Model preflight failed: \(error)"
        }

        if failure == nil {
            do {
                let stream = try await engine.generate(
                    session: session,
                    request: GenerationRequest(
                        requestId: requestID,
                        prompt: evaluationCase.prompt,
                        maxTokens: evaluationCase.maxTokens,
                        temperature: evaluationCase.temperature
                    )
                )
                for try await token in stream {
                    output += token.text
                }
            } catch {
                failure = String(describing: error)
            }
        }

        do {
            let finalHash = try Self.sha256(fileURL: modelFileURL)
            if finalHash != modelArtifactSHA256 {
                let mutation = "Model file changed during evaluation; this attempt cannot count as a verified native run."
                failure = [failure, mutation].compactMap { $0 }.joined(separator: " ")
            }
        } catch {
            failure = [failure, "Model file could not be re-verified after inference: \(error)"]
                .compactMap { $0 }.joined(separator: " ")
        }

        let completedAt = Date()
        let hasOutput = !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let status: NativeEvaluationAttempt.Status = failure == nil
            ? (hasOutput ? .completed : .failed)
            : (hasOutput ? .partial : .failed)
        let providerKind: NativeEvaluationAttempt.ProviderKind =
            engine is LlamaCppMetalBackend ? .llamaCppBackend : .unverifiedProvider
        let nativeObserved = providerKind == .llamaCppBackend && status == .completed
        let draft = NativeEvaluationAttemptDraft(
            id: UUID().uuidString,
            suiteID: evaluationCase.suiteID,
            suiteVersion: evaluationCase.suiteVersion,
            caseID: evaluationCase.caseID,
            evaluationCriteria: evaluationCase.evaluationCriteria,
            expectedOutcome: evaluationCase.expectedOutcome,
            modelID: session.modelId,
            modelArtifactSHA256: modelArtifactSHA256,
            runtimeSessionID: session.id,
            requestID: requestID,
            prompt: evaluationCase.prompt,
            output: output,
            status: status,
            providerKind: providerKind,
            nativeExecutionObserved: nativeObserved,
            errorMessage: failure ?? (hasOutput ? nil : "Runtime completed without producing output."),
            startedAt: startedAt,
            completedAt: completedAt,
            latencyMilliseconds: max(0, Int(completedAt.timeIntervalSince(startedAt) * 1000)),
            maxTokens: evaluationCase.maxTokens
        )
        return try await journal.appendAttempt(draft)
    }

    private static func sha256(fileURL: URL) throws -> String {
        let values = try fileURL.resourceValues(forKeys: [.isRegularFileKey])
        guard values.isRegularFile == true else {
            throw NativeEvaluationJournalError.invalidAttempt("Model artifact must be an existing regular file.")
        }
        let handle = try FileHandle(forReadingFrom: fileURL)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

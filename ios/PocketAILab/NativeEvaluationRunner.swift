import Foundation
import PocketLlamaEngine

struct NativeEvaluationCase: Sendable {
    let suiteID: String
    let suiteVersion: String
    let caseID: String
    let prompt: String
    let maxTokens: Int
    let temperature: Double

    init(suiteID: String, suiteVersion: String, caseID: String, prompt: String,
         maxTokens: Int = 256, temperature: Double = 0) {
        self.suiteID = suiteID
        self.suiteVersion = suiteVersion
        self.caseID = caseID
        self.prompt = prompt
        self.maxTokens = maxTokens
        self.temperature = temperature
    }
}

/// Executes benchmark cases through the app's injected native inference boundary.
/// Only a successful non-empty generation from LlamaCppMetalBackend is recorded
/// as observed native execution. This is not a signed runtime attestation and
/// never changes RuntimeTrustPresentation or grants APEX/East authority.
struct NativeEvaluationRunner: Sendable {
    private let engine: any LlamaEngine
    private let journal: NativeEvaluationJournal
    private let modelArtifactSHA256: String

    init(engine: any LlamaEngine, journal: NativeEvaluationJournal, modelArtifactSHA256: String) throws {
        guard modelArtifactSHA256.count == 64,
              modelArtifactSHA256.allSatisfy({ $0.isHexDigit }) else {
            throw NativeEvaluationJournalError.invalidAttempt("Model artifact fingerprint must be a SHA-256 hex digest.")
        }
        self.engine = engine
        self.journal = journal
        self.modelArtifactSHA256 = modelArtifactSHA256.lowercased()
    }

    func run(_ evaluationCase: NativeEvaluationCase, session: RuntimeSession) async throws -> NativeEvaluationAttempt {
        guard !evaluationCase.suiteID.isEmpty, !evaluationCase.suiteVersion.isEmpty,
              !evaluationCase.caseID.isEmpty,
              !evaluationCase.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
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

        let completedAt = Date()
        let hasOutput = !output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let status: NativeEvaluationAttempt.Status = failure == nil
            ? (hasOutput ? .completed : .failed)
            : (hasOutput ? .partial : .failed)
        let providerKind: NativeEvaluationAttempt.ProviderKind =
            engine is LlamaCppMetalBackend ? .llamaCppMetal : .unverifiedProvider
        let nativeObserved = providerKind == .llamaCppMetal && status == .completed
        let draft = NativeEvaluationAttemptDraft(
            id: UUID().uuidString,
            suiteID: evaluationCase.suiteID,
            suiteVersion: evaluationCase.suiteVersion,
            caseID: evaluationCase.caseID,
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
}

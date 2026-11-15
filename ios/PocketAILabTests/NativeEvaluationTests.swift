import XCTest
@testable import PocketAILab
import PocketLlamaEngine

final class NativeEvaluationTests: XCTestCase {
    private func makeJournal() throws -> (NativeEvaluationJournal, URL, URL) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PocketAILab-NativeEvaluation-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let journalURL = directory.appendingPathComponent("history.ndjson")
        let modelURL = directory.appendingPathComponent("test-model.gguf")
        try Data("test model artifact".utf8).write(to: modelURL)
        return (try NativeEvaluationJournal(fileURL: journalURL), directory, modelURL)
    }

    private func evaluationCase(caseID: String = "basic-math") -> NativeEvaluationCase {
        NativeEvaluationCase(
            suiteID: "core-capabilities", suiteVersion: "1.0.0",
            caseID: caseID, prompt: "What is 6 multiplied by 7?",
            evaluationCriteria: "Compute accurately and return the numeric result.",
            expectedOutcome: "42", maxTokens: 64, temperature: 0
        )
    }

    func testRunnerExecutesInjectedEngineAndNeverPromotesTestDoubleToNativeEvidence() async throws {
        let (journal, directory, modelURL) = try makeJournal()
        defer { try? FileManager.default.removeItem(at: directory) }
        let engine = MockEvaluationEngine(responses: ["42"])
        let runner = try NativeEvaluationRunner(engine: engine, journal: journal, modelFileURL: modelURL)

        let attempt = try await runner.run(
            evaluationCase(), session: RuntimeSession(id: "test-session", modelId: "model-a")
        )

        XCTAssertEqual(attempt.output, "42")
        XCTAssertEqual(attempt.status, .completed)
        XCTAssertEqual(attempt.providerKind, .unverifiedProvider)
        XCTAssertFalse(attempt.nativeExecutionObserved)
        XCTAssertFalse(attempt.runtimeTrustVerified)
        XCTAssertEqual(attempt.modelArtifactSHA256.count, 64)
        let prompts = await engine.prompts()
        XCTAssertEqual(prompts, ["What is 6 multiplied by 7?"])
        let events = try await journal.events()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].payload.attempt, attempt)
    }

    func testPartialOutputAndFailureArePersistedAndRetriesDoNotOverwriteHistory() async throws {
        let (journal, directory, modelURL) = try makeJournal()
        defer { try? FileManager.default.removeItem(at: directory) }
        let partialEngine = MockEvaluationEngine(responses: ["partial answer"], failAfterOutput: true)
        let partialRunner = try NativeEvaluationRunner(engine: partialEngine, journal: journal, modelFileURL: modelURL)
        let first = try await partialRunner.run(
            evaluationCase(), session: RuntimeSession(id: "session-1", modelId: "model-a")
        )
        XCTAssertEqual(first.status, .partial)
        XCTAssertEqual(first.output, "partial answer")
        XCTAssertNotNil(first.errorMessage)
        XCTAssertEqual(first.attemptNumber, 1)
        XCTAssertNil(first.retryOfAttemptID)

        let retryEngine = MockEvaluationEngine(responses: ["42"])
        let retryRunner = try NativeEvaluationRunner(engine: retryEngine, journal: journal, modelFileURL: modelURL)
        let second = try await retryRunner.run(
            evaluationCase(), session: RuntimeSession(id: "session-2", modelId: "model-a")
        )
        XCTAssertEqual(second.status, .completed)
        XCTAssertEqual(second.attemptNumber, 2)
        XCTAssertEqual(second.retryOfAttemptID, first.id)

        let reopened = try NativeEvaluationJournal(fileURL: directory.appendingPathComponent("history.ndjson"))
        let events = try await reopened.events()
        let attempts = events.compactMap(\.payload.attempt)
        XCTAssertEqual(attempts.count, 2)
        XCTAssertEqual(attempts.map(\.id), [first.id, second.id])
        XCTAssertEqual(attempts.map(\.output), ["partial answer", "42"])
        XCTAssertEqual(attempts.map(\.status), [.partial, .completed])
    }

    func testEmptyGenerationIsRetainedAsFailedAttempt() async throws {
        let (journal, directory, modelURL) = try makeJournal()
        defer { try? FileManager.default.removeItem(at: directory) }
        let engine = MockEvaluationEngine(responses: [""])
        let runner = try NativeEvaluationRunner(engine: engine, journal: journal, modelFileURL: modelURL)

        let attempt = try await runner.run(
            evaluationCase(), session: RuntimeSession(id: "session-empty", modelId: "model-a")
        )

        XCTAssertEqual(attempt.status, .failed)
        XCTAssertEqual(attempt.output, "")
        XCTAssertNotNil(attempt.errorMessage)
        let events = try await journal.events()
        XCTAssertEqual(events.count, 1)
    }

    func testLlamaCppProviderFailureDoesNotClaimNativeGeneration() async throws {
        let (journal, directory, modelURL) = try makeJournal()
        defer { try? FileManager.default.removeItem(at: directory) }
        let engine = LlamaCppMetalBackend(requireMetal: true)
        let runner = try NativeEvaluationRunner(engine: engine, journal: journal, modelFileURL: modelURL)

        let attempt = try await runner.run(
            evaluationCase(), session: RuntimeSession(id: "not-loaded", modelId: "model-a")
        )

        XCTAssertEqual(attempt.providerKind, .llamaCppBackend)
        XCTAssertEqual(attempt.status, .failed)
        XCTAssertFalse(attempt.nativeExecutionObserved)
        XCTAssertFalse(attempt.runtimeTrustVerified)
        XCTAssertNotNil(attempt.errorMessage)
    }

    func testCriticValidatorAndModelChallengesAreSeparateAppendOnlyEvents() async throws {
        let (journal, directory, modelURL) = try makeJournal()
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try NativeEvaluationRunner(
            engine: MockEvaluationEngine(responses: ["42"]),
            journal: journal, modelFileURL: modelURL
        )
        let attempt = try await runner.run(
            evaluationCase(), session: RuntimeSession(id: "subject-session", modelId: "model-a")
        )

        let critic = NativeEvaluationAssessment(
            id: "critic-1", attemptID: attempt.id, evaluatorRole: .critic,
            evaluatorAgentID: "critic", evaluatorModelID: "reviewer-model",
            evaluatorRuntimeSessionID: "critic-session", rubricVersion: "rubric-1",
            score: 0.9, categoryScores: NativeEvaluationCategory.allCases.map { NativeEvaluationCategoryScore(category: $0, score: 0.9) },
            passed: true, rationale: "The result is correct.", assessedAt: Date()
        )
        let validator = NativeEvaluationAssessment(
            id: "validator-1", attemptID: attempt.id, evaluatorRole: .validator,
            evaluatorAgentID: "validator", evaluatorModelID: "reviewer-model",
            evaluatorRuntimeSessionID: "validator-session", rubricVersion: "rubric-1",
            score: 0.85, categoryScores: NativeEvaluationCategory.allCases.map { NativeEvaluationCategoryScore(category: $0, score: 0.85) },
            passed: true, rationale: "Independent verification agrees.", assessedAt: Date()
        )
        try await journal.appendAssessment(critic)
        try await journal.appendAssessment(validator)
        try await journal.appendChallenge(NativeEvaluationChallenge(
            id: "challenge-1", attemptID: attempt.id, authorAgentID: "reasoner",
            reason: "The rubric omitted an edge case.", submittedAt: Date()
        ))

        do {
            try await journal.appendAssessment(NativeEvaluationAssessment(
                id: "invalid-review", attemptID: attempt.id, evaluatorRole: .critic,
                evaluatorAgentID: "critic", evaluatorModelID: "reviewer-model",
                evaluatorRuntimeSessionID: attempt.runtimeSessionID, rubricVersion: "rubric-1",
                score: 1, categoryScores: NativeEvaluationCategory.allCases.map { NativeEvaluationCategoryScore(category: $0, score: 1) },
                passed: true, rationale: "Same session must be rejected.", assessedAt: Date()
            ))
            XCTFail("same-session review must not count as independent")
        } catch NativeEvaluationJournalError.assessmentMustUseSeparateRuntimeSession {
        }

        let events = try await journal.events()
        XCTAssertEqual(events.map(\.payload.kind), [.attempt, .assessment, .assessment, .challenge])
        XCTAssertEqual(events.compactMap(\.payload.assessment).map(\.evaluatorRole), [.critic, .validator])
        XCTAssertEqual(events.compactMap(\.payload.challenge).map(\.id), ["challenge-1"])
        XCTAssertEqual(events.compactMap(\.payload.attempt).count, 1)
    }

    func testHashChainDetectsModifiedHistoricalOutput() async throws {
        let (journal, directory, modelURL) = try makeJournal()
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try NativeEvaluationRunner(
            engine: MockEvaluationEngine(responses: ["original-output"]),
            journal: journal, modelFileURL: modelURL
        )
        _ = try await runner.run(
            evaluationCase(), session: RuntimeSession(id: "session", modelId: "model-a")
        )
        let file = directory.appendingPathComponent("history.ndjson")
        var contents = try String(contentsOf: file, encoding: .utf8)
        contents = contents.replacingOccurrences(of: "original-output", with: "changed-output")
        try contents.write(to: file, atomically: true, encoding: .utf8)

        XCTAssertThrowsError(try NativeEvaluationJournal(fileURL: file))
    }

    func testModelMutationDuringGenerationIsRetainedButNotCountedAsNative() async throws {
        let (journal, directory, modelURL) = try makeJournal()
        defer { try? FileManager.default.removeItem(at: directory) }
        let engine = MockEvaluationEngine(responses: ["42"], mutateFile: modelURL)
        let runner = try NativeEvaluationRunner(engine: engine, journal: journal, modelFileURL: modelURL)

        let attempt = try await runner.run(
            evaluationCase(), session: RuntimeSession(id: "session", modelId: "model-a")
        )

        XCTAssertEqual(attempt.output, "42")
        XCTAssertEqual(attempt.status, .partial)
        XCTAssertFalse(attempt.nativeExecutionObserved)
        XCTAssertTrue(attempt.errorMessage?.contains("Model file changed") == true)
    }

    func testMissingModelFileIsRejectedBeforeInference() async throws {
        let (journal, directory, modelURL) = try makeJournal()
        defer { try? FileManager.default.removeItem(at: directory) }
        let engine = MockEvaluationEngine(responses: ["must not run"])
        try FileManager.default.removeItem(at: modelURL)
        XCTAssertThrowsError(try NativeEvaluationRunner(
            engine: engine, journal: journal, modelFileURL: modelURL
        ))
        let prompts = await engine.prompts()
        XCTAssertTrue(prompts.isEmpty)
    }
}

private actor MockEvaluationEngine: LlamaEngine {
    private let responses: [String]
    private let failAfterOutput: Bool
    private let mutateFile: URL?
    private var recordedPrompts: [String] = []

    init(responses: [String], failAfterOutput: Bool = false, mutateFile: URL? = nil) {
        self.responses = responses
        self.failAfterOutput = failAfterOutput
        self.mutateFile = mutateFile
    }

    func prompts() -> [String] { recordedPrompts }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: "mock-session", modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        recordedPrompts.append(request.prompt)
        let chunks = responses
        let shouldFail = failAfterOutput
        let mutationURL = mutateFile
        if let mutationURL {
            try Data("mutated model artifact".utf8).write(to: mutationURL)
        }
        return AsyncThrowingStream { continuation in
            for chunk in chunks {
                continuation.yield(Token(text: chunk, isComplete: false))
            }
            if shouldFail {
                continuation.finish(throwing: LlamaEngineError.backendFailed("Synthetic test-stream failure"))
            } else {
                continuation.finish()
            }
        }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
}

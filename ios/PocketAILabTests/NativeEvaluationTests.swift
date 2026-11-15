import XCTest
@testable import PocketAILab
import PocketLlamaEngine

final class NativeEvaluationTests: XCTestCase {
    private func makeContext(
        responses: [String],
        failAfterOutput: Bool = false,
        mutateFile: Bool = false
    ) async throws -> (NativeEvaluationJournal, URL, URL, NativeInferenceRuntime, ModelPoolLease, MockEvaluationEngine) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PocketAILab-NativeEvaluation-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let journalURL = directory.appendingPathComponent("history.ndjson")
        let modelURL = directory.appendingPathComponent("test-model.gguf")
        try Data("test model artifact".utf8).write(to: modelURL)
        let journal = try NativeEvaluationJournal(fileURL: journalURL)
        let engine = MockEvaluationEngine(responses: responses, failAfterOutput: failAfterOutput,
                                          mutationURL: mutateFile ? modelURL : nil)
        let fingerprint = try ModelArtifactFingerprint.compute(at: modelURL)
        let descriptor = ModelDescriptor(
            id: "sha256-\(fingerprint.sha256)", name: "Test model",
            path: modelURL.path, contextLength: 512, quantization: "test"
        )
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: ModelPoolConfiguration(
                maxResidentMemoryMB: 1024, maxLoadedModels: 1, minimumFreeMemoryMB: 128
            ),
            availableMemoryMB: { 2048 },
            maxConcurrentRequests: 1
        )
        let lease = try await runtime.acquire(model: descriptor, estimatedMemoryMB: 128)
        return (journal, directory, modelURL, runtime, lease, engine)
    }

    private func evaluationCase(
        category: NativeEvaluationCategory = .reasoningProblemSolving,
        caseID: String = "basic-math"
    ) -> NativeEvaluationCase {
        NativeEvaluationCase(
            category: category, suiteID: "core-capabilities", suiteVersion: "1.0.0",
            caseID: caseID, prompt: "What is 6 multiplied by 7?",
            evaluationCriteria: "Compute accurately and return the numeric result.",
            expectedOutcome: "42", scoringRule: .exactMatch, maxTokens: 64, temperature: 0
        )
    }

    private func makeRunner(
        runtime: NativeInferenceRuntime,
        lease: ModelPoolLease,
        journal: NativeEvaluationJournal,
        modelURL: URL
    ) throws -> NativeEvaluationRunner {
        try NativeEvaluationRunner(runtime: runtime, lease: lease, journal: journal, modelFileURL: modelURL)
    }

    func testRunnerUsesExactModelPoolLeaseAndNeverPromotesTestDoubleToNativeEvidence() async throws {
        let (journal, directory, modelURL, runtime, lease, engine) = try await makeContext(responses: ["42"])
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)

        let attempt = try await runner.run(evaluationCase())

        XCTAssertEqual(attempt.output, "42")
        XCTAssertEqual(attempt.category, .reasoningProblemSolving)
        XCTAssertEqual(attempt.status, .completed)
        XCTAssertEqual(attempt.providerKind, .unverifiedProvider)
        XCTAssertFalse(attempt.nativeExecutionObserved)
        XCTAssertFalse(attempt.runtimeTrustVerified)
        XCTAssertEqual(attempt.modelArtifactSHA256.count, 64)
        XCTAssertEqual(attempt.modelID, lease.model.id)
        XCTAssertEqual(attempt.deterministicPassed, true)
        XCTAssertEqual(attempt.deterministicScore, 1.0)
        XCTAssertEqual(attempt.runtimeSessionID, lease.session.id)
        let prompts = await engine.prompts()
        XCTAssertEqual(prompts, ["What is 6 multiplied by 7?"])
        let events = try await journal.events()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].payload.attempt, attempt)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
    }

    func testPartialOutputAndRetriesArePersistedWithoutOverwritingHistory() async throws {
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(
            responses: ["partial answer"], failAfterOutput: true
        )
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)
        let first = try await runner.run(evaluationCase())
        XCTAssertEqual(first.status, .partial)
        XCTAssertEqual(first.output, "partial answer")
        XCTAssertNotNil(first.errorMessage)
        XCTAssertEqual(first.attemptNumber, 1)
        XCTAssertNil(first.retryOfAttemptID)

        let secondRunner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)
        let second = try await secondRunner.run(evaluationCase())
        XCTAssertEqual(second.status, .completed)
        XCTAssertEqual(second.attemptNumber, 2)
        XCTAssertEqual(second.retryOfAttemptID, first.id)
        XCTAssertEqual(second.deterministicPassed, true)
        let summary = NativeEvaluationScoreSummary(attempts: [first, second])
        XCTAssertEqual(summary.totalAttempts, 1)
        XCTAssertEqual(summary.scorePercent, 100)

        let reopened = try NativeEvaluationJournal(fileURL: directory.appendingPathComponent("history.ndjson"))
        let events = try await reopened.events()
        let attempts = events.compactMap(\.payload.attempt)
        XCTAssertEqual(attempts.count, 2)
        XCTAssertEqual(attempts.map(\.id), [first.id, second.id])
        XCTAssertEqual(attempts.map(\.output), ["partial answer", "42"])
        XCTAssertEqual(attempts.map(\.status), [.partial, .completed])
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
    }

    func testEmptyGenerationIsRetainedAsFailedAttempt() async throws {
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(responses: [""])
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)

        let attempt = try await runner.run(evaluationCase())

        XCTAssertEqual(attempt.status, .failed)
        XCTAssertEqual(attempt.deterministicPassed, false)
        XCTAssertEqual(attempt.deterministicScore, 0.0)
        XCTAssertEqual(attempt.output, "")
        XCTAssertNotNil(attempt.errorMessage)
        let events = try await journal.events()
        XCTAssertEqual(events.count, 1)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
    }

    func testReleasedLeaseCannotProduceNativeEvaluationAttempt() async throws {
        let (journal, directory, modelURL, runtime, lease, engine) = try await makeContext(responses: ["must not run"])
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)

        let attempt = try await runner.run(evaluationCase())

        XCTAssertEqual(attempt.status, .failed)
        XCTAssertFalse(attempt.nativeExecutionObserved)
        XCTAssertTrue(attempt.errorMessage?.contains("invalidLease") == true)
        let prompts = await engine.prompts()
        XCTAssertTrue(prompts.isEmpty)
        let events = try await journal.events()
        XCTAssertEqual(events.compactMap(\.payload.attempt).count, 1)
    }

    func testModelMutationDuringGenerationIsRetainedButNotCountedAsNative() async throws {
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(
            responses: ["42"], mutateFile: true
        )
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)

        let attempt = try await runner.run(evaluationCase())

        XCTAssertEqual(attempt.output, "42")
        XCTAssertEqual(attempt.status, .partial)
        XCTAssertEqual(attempt.deterministicPassed, false)
        XCTAssertEqual(attempt.deterministicScore, 0.0)
        XCTAssertFalse(attempt.nativeExecutionObserved)
        XCTAssertTrue(attempt.errorMessage?.contains("Model file changed") == true)
        let events = try await journal.events()
        XCTAssertEqual(events.compactMap(\.payload.attempt).count, 1)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
    }

    func testCriticValidatorAndChallengesAreSeparateAppendOnlyEvents() async throws {
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(responses: ["42"])
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)
        let attempt = try await runner.run(evaluationCase())

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
                passed: true, rationale: "Same session must not count as independent.", assessedAt: Date()
            ))
            XCTFail("same-session review must not count as independent")
        } catch NativeEvaluationJournalError.assessmentMustUseSeparateRuntimeSession {
        }

        let events = try await journal.events()
        XCTAssertEqual(events.map(\.payload.kind), [.attempt, .assessment, .assessment, .challenge])
        XCTAssertEqual(events.compactMap(\.payload.assessment).map(\.evaluatorRole), [.critic, .validator])
        XCTAssertEqual(events.compactMap(\.payload.challenge).map(\.id), ["challenge-1"])
        XCTAssertEqual(events.compactMap(\.payload.attempt).count, 1)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
    }

    func testHashChainDetectsModifiedHistoricalOutput() async throws {
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(responses: ["original-output"])
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)
        _ = try await runner.run(evaluationCase())
        let file = directory.appendingPathComponent("history.ndjson")
        var contents = try String(contentsOf: file, encoding: .utf8)
        contents = contents.replacingOccurrences(of: "original-output", with: "changed-output")
        try contents.write(to: file, atomically: true, encoding: .utf8)

        XCTAssertThrowsError(try NativeEvaluationJournal(fileURL: file))
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
    }

    func testRuntimeOwnedProviderIdentityDistinguishesLlamaCppFromTestEngine() async throws {
        let nativeRuntime = try NativeInferenceRuntime(
            engine: LlamaCppMetalBackend(requireMetal: true),
            poolConfiguration: ModelPoolConfiguration(maxResidentMemoryMB: 1024, maxLoadedModels: 1),
            availableMemoryMB: { 2048 }
        )
        let (journal, directory, modelURL, testRuntime, lease, _) = try await makeContext(responses: ["ok"])
        defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertEqual(nativeRuntime.providerKind, .llamaCpp)
        XCTAssertEqual(testRuntime.providerKind, .other)
        let runner = try makeRunner(runtime: testRuntime, lease: lease, journal: journal, modelURL: modelURL)
        let attempt = try await runner.run(evaluationCase())
        XCTAssertEqual(attempt.providerKind, .unverifiedProvider)
        XCTAssertFalse(attempt.nativeExecutionObserved)
        let released = await testRuntime.release(lease)
        XCTAssertTrue(released)
    }
}

private actor MockEvaluationEngine: LlamaEngine {
    private let responses: [String]
    private let failAfterOutput: Bool
    private let mutationURL: URL?
    private var recordedPrompts: [String] = []
    private var generations = 0

    init(responses: [String], failAfterOutput: Bool = false, mutationURL: URL? = nil) {
        self.responses = responses
        self.failAfterOutput = failAfterOutput
        self.mutationURL = mutationURL
    }

    func prompts() -> [String] { recordedPrompts }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: "mock-session-\(model.id)", modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        recordedPrompts.append(request.prompt)
        let chunks = responses
        generations += 1
        let shouldFail = failAfterOutput && generations == 1
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
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
}

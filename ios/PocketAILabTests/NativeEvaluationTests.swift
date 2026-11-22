import XCTest
@testable import PocketAILab
import PocketLlamaEngine

final class NativeEvaluationTests: XCTestCase {
    private func makeContext(
        responses: [[String]],
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
        caseID: String = "basic-math",
        scoringRule: NativeEvaluationScoringRule = .exactMatch
    ) -> NativeEvaluationCase {
        NativeEvaluationCase(
            category: category, suiteID: "core-capabilities", suiteVersion: "1.0.0",
            caseID: caseID, prompt: "What is 6 multiplied by 7?",
            evaluationCriteria: "Compute accurately and return the numeric result.",
            expectedOutcome: "42", scoringRule: scoringRule, maxTokens: 64, temperature: 0
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


    func testHistoryDetectsRemovedTailAndExportKeepsTheSelectedAttempt() async throws {
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(responses: [["42"], ["42"]])
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)
        _ = try await runner.run(evaluationCase())
        let journalURL = directory.appendingPathComponent("history.ndjson")
        let firstRecord = try Data(contentsOf: journalURL)
        _ = try await runner.run(evaluationCase())
        let history = try await journal.events()
        let last = try XCTUnwrap(history.last)
        XCTAssertEqual(last.sequence, 2)
        let bytes = try NativeEvaluationJournal.exportAttempt(last)
        let packet = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        XCTAssertEqual(packet["eventHash"] as? String, last.eventHash)
        let payload = try XCTUnwrap(packet["payloadJSON"] as? String)
        let decoded = try JSONDecoder().decode(NativeEvaluationJournalPayload.self, from: Data(payload.utf8))
        XCTAssertEqual(decoded, last.payload)
        XCTAssertEqual(decoded.attempt?.runtimeTrustVerified, false)

        try firstRecord.write(to: journalURL, options: .atomic)
        do {
            _ = try await journal.events()
            XCTFail("A live journal accepted a shortened valid prefix.")
        } catch NativeEvaluationJournalError.corruptJournal { }
    }

    func testStarterSuiteCoversEightCategoriesAndMarksOnlyObjectiveCasesForScoring() {
        XCTAssertEqual(NativeEvaluationSuite.cases.count, 8)
        XCTAssertEqual(Set(NativeEvaluationSuite.cases.map(\.category)), Set(NativeEvaluationCategory.allCases))
        let objective = NativeEvaluationSuite.cases.filter { $0.scoringRule != .manualReview }
        let manual = NativeEvaluationSuite.cases.filter { $0.scoringRule == .manualReview }
        XCTAssertEqual(objective.count, 4)
        XCTAssertEqual(manual.count, 4)
        XCTAssertTrue(manual.allSatisfy { !$0.evaluationCriteria.isEmpty })
    }

    func testRunnerUsesExactModelPoolLeaseAndNeverPromotesTestDoubleToNativeEvidence() async throws {
        let (journal, directory, modelURL, runtime, lease, engine) = try await makeContext(responses: [["42"]])
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
        XCTAssertEqual(attempt.estimatedMemoryMB, lease.estimatedMemoryMB)
        XCTAssertEqual(attempt.promptUTF8Bytes, attempt.prompt.utf8.count)
        XCTAssertEqual(attempt.outputUTF8Bytes, attempt.output.utf8.count)
        let prompts = await engine.prompts()
        XCTAssertEqual(prompts, ["What is 6 multiplied by 7?"])
        let events = try await journal.events()
        XCTAssertEqual(events.count, 1)
        XCTAssertEqual(events[0].payload.attempt, attempt)
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
    }

    func testExactAnswerScoresTheBytesDeliveredByTheRuntime() async throws {
        let task = try XCTUnwrap(NativeEvaluationSuite.cases.first { $0.caseID == "task-exact-token" })
        let expected = task.expectedOutcome
        let outputs = [" " + expected, expected + "\n", expected]
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(responses: outputs.map { [$0] })
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)
        for output in outputs {
            let attempt = try await runner.run(task)
            XCTAssertEqual(attempt.output, output)
            XCTAssertEqual(attempt.status, .completed)
            XCTAssertEqual(attempt.deterministicPassed, output == expected)
            XCTAssertEqual(attempt.deterministicScore, output == expected ? 1 : 0)
        }
        let reopened = try NativeEvaluationJournal(fileURL: directory.appendingPathComponent("history.ndjson"))
        let events = try await reopened.events()
        XCTAssertEqual(events.compactMap { $0.payload.attempt?.deterministicPassed }, [false, false, true])
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
    }

    func testPartialOutputAndRetriesArePersistedWithoutOverwritingHistory() async throws {
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(
            responses: [["partial answer"], ["42"]], failAfterOutput: true
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
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(responses: [[""]])
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

    func testManualReviewAttemptIsPersistedAsUnscored() async throws {
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(
            responses: [["A reviewer should assess this response."]]
        )
        defer { try? FileManager.default.removeItem(at: directory) }
        let runner = try makeRunner(runtime: runtime, lease: lease, journal: journal, modelURL: modelURL)

        let attempt = try await runner.run(evaluationCase(
            category: .codingEngineering,
            caseID: "manual-review-only",
            scoringRule: .manualReview
        ))

        XCTAssertEqual(attempt.status, .completed)
        XCTAssertNil(attempt.deterministicPassed)
        XCTAssertNil(attempt.deterministicScore)
        let summary = NativeEvaluationScoreSummary(attempts: [attempt])
        XCTAssertEqual(summary.totalAttempts, 1)
        XCTAssertEqual(summary.scoredAttempts, 0)
        XCTAssertEqual(summary.unscoredAttempts, 1)
        XCTAssertNil(summary.scorePercent)
        let events = try await journal.events()
        XCTAssertEqual(events.compactMap(\.payload.attempt).map(\.id), [attempt.id])
        let released = await runtime.release(lease)
        XCTAssertTrue(released)
    }

    func testReleasedLeaseCannotProduceNativeEvaluationAttempt() async throws {
        let (journal, directory, modelURL, runtime, lease, engine) = try await makeContext(responses: [["must not run"]])
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
            responses: [["42"]], mutateFile: true
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
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(responses: [["42"]])
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
            try await journal.appendAssessment(critic)
            XCTFail("Duplicate assessment IDs must be rejected")
        } catch NativeEvaluationJournalError.invalidAssessment {
        }
        do {
            try await journal.appendChallenge(NativeEvaluationChallenge(
                id: "challenge-1", attemptID: attempt.id, authorAgentID: "reasoner",
                reason: "Duplicate challenge ID.", submittedAt: Date()
            ))
            XCTFail("Duplicate challenge IDs must be rejected")
        } catch NativeEvaluationJournalError.invalidChallenge {
        }

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

        do {
            try await journal.appendAssessment(NativeEvaluationAssessment(
                id: "self-review", attemptID: attempt.id, evaluatorRole: .critic,
                evaluatorAgentID: "critic", evaluatorModelID: attempt.modelID,
                evaluatorRuntimeSessionID: "different-session", rubricVersion: "rubric-1",
                score: 1, categoryScores: NativeEvaluationCategory.allCases.map { NativeEvaluationCategoryScore(category: $0, score: 1) },
                passed: true, rationale: "The subject model cannot independently grade itself.", assessedAt: Date()
            ))
            XCTFail("The subject model cannot be its own independent evaluator")
        } catch NativeEvaluationJournalError.assessmentMustUseDifferentModel {
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
        let (journal, directory, modelURL, runtime, lease, _) = try await makeContext(responses: [["original-output"]])
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

    @MainActor
    func testLocalChatModelRunsSuiteThroughItsCatalogSelectedLease() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PocketAILab-LocalEvaluation-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let modelDirectory = directory.appendingPathComponent("Models", isDirectory: true)
        let sourceURL = directory.appendingPathComponent("suite-model.gguf")
        var header = Data("GGUF".utf8)
        for value: UInt32 in [3, 0, 0, 0, 0] {
            var littleEndian = value.littleEndian
            withUnsafeBytes(of: &littleEndian) { header.append(contentsOf: $0) }
        }
        try header.write(to: sourceURL)

        let journal = try NativeEvaluationJournal(fileURL: directory.appendingPathComponent("evaluation.ndjson"))
        let engine = MockEvaluationEngine(responses: [["42"]])
        let model = LocalChatModel(
            engine: engine,
            modelDirectory: modelDirectory,
            conversationStore: LocalConversationStore(fileURL: directory.appendingPathComponent("conversation.json")),
            agentTaskHistoryStore: LocalAgentTaskHistoryStore(fileURL: directory.appendingPathComponent("agent-tasks.json")),
            modelCatalogStore: LocalModelCatalogStore(
                fileURL: directory.appendingPathComponent("catalog.json"),
                modelDirectory: modelDirectory
            ),
            evaluationJournal: journal,
            availableMemoryMB: { 4_096 }
        )

        try await model.importModel(from: sourceURL)
        await model.loadModel()
        XCTAssertTrue(model.isModelLoaded, model.status)

        await model.runSelfEvaluation()

        let events = try await journal.events()
        let attempts = events.compactMap(\.payload.attempt)
        XCTAssertEqual(attempts.count, NativeEvaluationSuite.cases.count)
        let selectedModelID = try XCTUnwrap(model.selectedModelID)
        XCTAssertTrue(attempts.allSatisfy { $0.modelID == selectedModelID })
        XCTAssertEqual(Set(attempts.map(\.runtimeSessionID)).count, 1)
        XCTAssertTrue(attempts.allSatisfy { $0.providerKind == .unverifiedProvider })
        XCTAssertTrue(attempts.allSatisfy { !$0.nativeExecutionObserved && !$0.runtimeTrustVerified })
        XCTAssertTrue(model.evaluationStatus.contains("\(NativeEvaluationSuite.cases.count) retained attempts"))

        let frozen = try PassageCheckSuite.bundledCases()
        XCTAssertEqual(frozen.count, 6)
        await model.runSelfEvaluation(sourceCheck: true)
        await model.unloadModel()
        let reopened = try NativeEvaluationJournal(fileURL: directory.appendingPathComponent("evaluation.ndjson"))
        let durable = try await reopened.events().compactMap(\.payload.attempt)
        let passage = durable.filter { $0.suiteID == "pocket-passage-evidence" }
        XCTAssertEqual(passage.map(\.caseID), frozen.map(\.caseID))
        XCTAssertEqual(passage.map(\.prompt), frozen.map(\.prompt))
        XCTAssertEqual(passage.map(\.expectedOutcome), frozen.map(\.expectedOutcome))
        XCTAssertTrue(passage.allSatisfy { $0.deterministicPassed == false && !$0.nativeExecutionObserved })
        XCTAssertEqual(durable.count, attempts.count + passage.count)
        XCTAssertTrue(attempts.allSatisfy { $0.resourceSamples == nil })
        for attempt in passage {
            let samples = try XCTUnwrap(attempt.resourceSamples)
            XCTAssertGreaterThanOrEqual(samples.sampleCount, 2)
            XCTAssertGreaterThan(try XCTUnwrap(samples.maxObservedFootprintBytes), 0)
            XCTAssertEqual(samples.environment, .current)
            #if targetEnvironment(simulator)
            XCTAssertNil(samples.minObservedHeadroomBytes)
            #endif
        }
        // CI only: retain one export from the reopened test journal for the independent reader.
        let eventsAfterRestart = try await reopened.events()
        let event = try XCTUnwrap(eventsAfterRestart.first { $0.payload.attempt?.caseID == frozen.first?.caseID })
        let packet = try NativeEvaluationJournal.exportAttempt(event)
        print("POCKET_RESOURCE_SAMPLE_FIXTURE \(event.eventHash) \(packet.base64EncodedString())")


    }

    func testResourceSummaryPreservesExtremaThroughMissingReadings() {
        var result = EvaluationResourceSamples()
        result.record(.init(footprintBytes: 100, headroomBytes: 40, thermalState: .fair, lowPowerMode: false))
        result.record(.init(footprintBytes: 180, headroomBytes: 0, thermalState: .serious, lowPowerMode: true))
        result.record(.init(footprintBytes: nil, headroomBytes: nil, thermalState: nil, lowPowerMode: false))
        result.record(.init(footprintBytes: 75, headroomBytes: 80, thermalState: .nominal, lowPowerMode: false))
        XCTAssertEqual(result.sampleCount, 4)
        XCTAssertEqual(result.maxObservedFootprintBytes, 180)
        XCTAssertEqual(result.minObservedHeadroomBytes, 0)
        XCTAssertEqual(result.worstObservedThermalState, .serious)
        XCTAssertTrue(result.lowPowerModeObserved)
    }

    func testRuntimeOwnedProviderIdentityDistinguishesLlamaCppFromTestEngine() async throws {
        let nativeRuntime = try NativeInferenceRuntime(
            engine: LlamaCppMetalBackend(requireMetal: true),
            poolConfiguration: ModelPoolConfiguration(maxResidentMemoryMB: 1024, maxLoadedModels: 1),
            availableMemoryMB: { 2048 }
        )
        let (journal, directory, modelURL, testRuntime, lease, _) = try await makeContext(responses: [["ok"]])
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
    private let responses: [[String]]
    private let failAfterOutput: Bool
    private let mutationURL: URL?
    private var recordedPrompts: [String] = []
    private var generations = 0

    init(responses: [[String]], failAfterOutput: Bool = false, mutationURL: URL? = nil) {
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
        generations += 1
        let responseIndex = min(generations - 1, responses.count - 1)
        let chunks = responses[responseIndex]
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

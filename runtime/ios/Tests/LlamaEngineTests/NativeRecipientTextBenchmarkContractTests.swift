import Foundation
import XCTest
@testable import PocketLlamaEngine

final class NativeRecipientTextBenchmarkContractTests: XCTestCase {
    func testManifestIsFrozenBeforeAnyModelExecution() throws {
        let digest = "376b9eef0c0b6b935307a4e9b2ce48ad5780281a1944394ac7a174a40ca3a51d"
        XCTAssertEqual(NativeRecipientTextBenchmark.expectedManifestSHA256, digest)
        XCTAssertEqual(NativeRecipientTextBenchmark.manifestSHA256, digest)
        XCTAssertEqual(NativeRecipientTextBenchmark.manifestData.count, 13_085)
        XCTAssertTrue(NativeRecipientTextBenchmark.manifestData.allSatisfy { $0 < 0x80 })
        XCTAssertEqual(NativeRecipientTextBenchmark.seed, 0x50414C5245435631)
        XCTAssertEqual(NativeRecipientTextBenchmark.maxPromptBytes, 512)
        XCTAssertEqual(NativeRecipientTextBenchmark.maxTokens, 4)
        XCTAssertEqual(NativeRecipientTextBenchmark.temperature, 0)
        XCTAssertEqual(NativeRecipientTextBenchmark.maxOutputBytes, 128)
        XCTAssertEqual(NativeRecipientTextBenchmark.maximumDurationSeconds, 900)
        XCTAssertEqual(NativeRecipientTextBenchmark.cases.map(\.objectId), [
            "OBJ-AB40EC30", "OBJ-CE12B00D", "OBJ-9427F894", "OBJ-C2CA1E40",
            "OBJ-9446327A", "OBJ-2BD4F1C7", "OBJ-5635CC63", "OBJ-89BD80FC",
            "OBJ-1F34C2A0", "OBJ-F987FDF1", "OBJ-97DD2BB4", "OBJ-2061C525"
        ])
        let first = try XCTUnwrap(NativeRecipientTextBenchmark.cases.first)
        XCTAssertEqual(first.prompt(for: .correct),
            "Read the message and answer the question.\n" +
            "Message: The stored word for OBJ-AB40EC30 is cedar.\n" +
            "Question: Which word is stored for OBJ-AB40EC30?\n" +
            "A: cedar\nB: maple\nReply with exactly A or B.\nAnswer:")
    }

    func testAllConditionOrdersAreCrossedWithBothKeysAndOptionPositionsAreBalanced() {
        let cases = NativeRecipientTextBenchmark.cases
        XCTAssertEqual(cases.count, 12)
        XCTAssertEqual(Set(cases.map(\.caseId)).count, 12)
        XCTAssertEqual(Set(cases.map(\.objectId)).count, 12)
        XCTAssertEqual(cases.filter { $0.correctAnswer == .a }.count, 6)
        XCTAssertEqual(cases.filter { $0.correctAnswer == .b }.count, 6)
        XCTAssertEqual(cases.filter { $0.optionA == "cedar" }.count, 6)
        XCTAssertEqual(cases.filter { $0.optionA == "maple" }.count, 6)

        let groups = Dictionary(grouping: cases) { $0.conditionOrder.map(\.rawValue).joined(separator: ",") }
        XCTAssertEqual(groups.count, 6)
        for group in groups.values {
            XCTAssertEqual(group.count, 2)
            XCTAssertEqual(Set(group.map(\.correctAnswer)), Set([NativeRecipientTextAnswer.a, .b]))
            let words = group.map { $0.correctAnswer == .a ? $0.optionA : $0.optionB }
            XCTAssertEqual(Set(words), Set(["cedar", "maple"]))
        }
        for position in 0..<3 {
            for condition in NativeRecipientTextCondition.allCases {
                XCTAssertEqual(cases.filter { $0.conditionOrder[position] == condition }.count, 4)
            }
        }
    }

    func testPromptContainsOnlyMessageQuestionAndOptionsWithoutEvaluationMetadata() {
        for item in NativeRecipientTextBenchmark.cases {
            let correctLines = item.prompt(for: .correct).components(separatedBy: "\n")
            let counterfactualLines = item.prompt(for: .counterfactual).components(separatedBy: "\n")
            let absentLines = item.prompt(for: .absent).components(separatedBy: "\n")
            XCTAssertEqual(correctLines.count, 7)
            XCTAssertEqual(correctLines.enumerated().filter { $0.offset != 1 }.map { $0.element },
                           counterfactualLines.enumerated().filter { $0.offset != 1 }.map { $0.element })
            XCTAssertEqual(correctLines.enumerated().filter { $0.offset != 1 }.map { $0.element },
                           absentLines.enumerated().filter { $0.offset != 1 }.map { $0.element })
            XCTAssertNotEqual(correctLines[1], counterfactualLines[1])
            XCTAssertFalse(absentLines[1].contains("cedar"))
            XCTAssertFalse(absentLines[1].contains("maple"))
            XCTAssertEqual(item.expectedAnswer(for: .absent), item.correctAnswer)
            XCTAssertEqual(item.expectedAnswer(for: .counterfactual), item.correctAnswer.opposite)
            for condition in item.conditionOrder {
                let prompt = item.prompt(for: condition)
                XCTAssertEqual(prompt.utf8.count, condition == .absent ? 197 : 195)
                XCTAssertLessThanOrEqual(prompt.utf8.count, NativeRecipientTextBenchmark.maxPromptBytes)
                XCTAssertTrue(prompt.utf8.allSatisfy { $0 < 0x80 })
                XCTAssertFalse(prompt.hasSuffix("\n"))
                for metadata in [item.caseId, "correct", "counterfactual", "absent", "expectedAnswer",
                                 NativeRecipientTextBenchmark.suiteID, "50414c5245435631", "50414C5245435631"] {
                    XCTAssertFalse(prompt.contains(metadata), "Metadata must not appear in the model prompt: \(metadata)")
                }
            }
        }
    }

    func testParserTrimsOnlyTheFourDeclaredASCIIWhitespaceBytes() {
        for text in ["A", " A", "A ", "\t\r\n A\t\n\r "] {
            XCTAssertEqual(NativeRecipientTextBenchmark.parseAnswer(text), .a)
        }
        for text in ["B", " \nB\t\r"] {
            XCTAssertEqual(NativeRecipientTextBenchmark.parseAnswer(text), .b)
        }
        for text in ["", " \t\r\n", "a", "b", "AB", "A B", "A\nB", "A.", "(A)", "Answer: A",
                     "A because cedar", "\"B\"", "\u{ff21}", "A\u{200b}", "\u{a0}A",
                     "A\u{a0}", "\u{b}A", "B\u{c}", "A\0"] {
            XCTAssertNil(NativeRecipientTextBenchmark.parseAnswer(text), "Unexpectedly accepted \(String(reflecting: text))")
        }
    }

    func testMessageOnlyOracleExercisesAllRowsAndPairedMetricsThroughTheRuntime() async throws {
        let engine = RecipientTextFixtureEngine()
        try await withFixture(engine: engine) { fixture in
            let recorder = RecipientTextTrialRecorder()
            let result = try await NativeRecipientTextBenchmark.run(
                runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest,
                onTrial: { await recorder.append($0) }
            )
            XCTAssertEqual(result.status, .completed)
            XCTAssertEqual(result.providerKind, "other", "A fixture cannot claim real native inference")
            XCTAssertEqual(result.modelId, fixture.lease.model.id)
            XCTAssertEqual(result.modelArtifactSHA256, fixture.digest)
            XCTAssertEqual(result.manifestSHA256, NativeRecipientTextBenchmark.expectedManifestSHA256)
            XCTAssertEqual(result.maximumDurationSeconds, 900)
            XCTAssertEqual(result.trials.count, 36)
            XCTAssertEqual(result.trials.map(\.ordinal), Array(1...36))
            XCTAssertEqual(Set(result.trials.compactMap(\.requestId)).count, 36)
            XCTAssertEqual(result.metrics.caseCount, 12)
            XCTAssertEqual(result.metrics.scheduledTrialCount, 36)
            XCTAssertEqual(result.metrics.attemptedTrialCount, 36)
            XCTAssertEqual(result.metrics.completedTrialCount, 36)
            XCTAssertEqual(result.metrics.generationFailedCount, 0)
            XCTAssertEqual(result.metrics.invalidAnswerCount, 0)
            XCTAssertEqual(result.metrics.notRunBudgetCount, 0)
            XCTAssertEqual(result.metrics.correctAnswerCount, 12)
            XCTAssertEqual(result.metrics.absentAnswerCount, 6)
            XCTAssertEqual(result.metrics.counterfactualFollowingCount, 12)
            XCTAssertEqual(result.metrics.correctAccuracy, 1)
            XCTAssertEqual(result.metrics.absentAccuracy, 0.5)
            XCTAssertEqual(result.metrics.counterfactualFollowingRate, 1)
            XCTAssertEqual(result.metrics.correctMinusAbsentAccuracy, 0.5)
            XCTAssertEqual(result.metrics.correctOnlyVsAbsentCount, 6)
            XCTAssertEqual(result.metrics.absentOnlyVsCorrectCount, 0)
            XCTAssertEqual(result.metrics.correctAndCounterfactualPairCount, 12)
            XCTAssertEqual(result.metrics.correctAndCounterfactualPairRate, 1)
            let recorded = await recorder.trials()
            XCTAssertEqual(recorded, result.trials)

            let calls = await engine.requests()
            let prompts = NativeRecipientTextBenchmark.cases.flatMap { item in
                item.conditionOrder.map { item.prompt(for: $0) }
            }
            XCTAssertEqual(calls.map(\.prompt), prompts)
            XCTAssertTrue(calls.allSatisfy { $0.maxTokens == 4 && $0.temperature == 0 })
            for (trial, request) in zip(result.trials, calls) {
                XCTAssertEqual(trial.requestId?.uuidString, request.requestId)
                XCTAssertEqual(trial.promptSHA256, NativeLatentSHA256.digest(Data(request.prompt.utf8)))
                XCTAssertEqual(trial.rawOutput, "\t\(trial.parsedAnswer!.rawValue)\r\n")
                XCTAssertGreaterThanOrEqual(trial.latencyMilliseconds, 0)
            }
        }
    }

    func testConstantAnswerDoesNotCountAsCounterfactualSwitching() async throws {
        let engine = RecipientTextFixtureEngine(defaultOutput: "A")
        try await withFixture(engine: engine) { fixture in
            let result = try await NativeRecipientTextBenchmark.run(
                runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest
            )
            XCTAssertEqual(result.metrics.correctAnswerCount, 6)
            XCTAssertEqual(result.metrics.absentAnswerCount, 6)
            XCTAssertEqual(result.metrics.counterfactualFollowingCount, 6)
            XCTAssertEqual(result.metrics.correctMinusAbsentAccuracy, 0)
            XCTAssertEqual(result.metrics.correctOnlyVsAbsentCount, 0)
            XCTAssertEqual(result.metrics.absentOnlyVsCorrectCount, 0)
            XCTAssertEqual(result.metrics.correctAndCounterfactualPairCount, 0)
            XCTAssertEqual(result.status, .completed, "Completion does not require a quality threshold")
        }
    }

    func testGenerationFailureAndInvalidAnswerKeepTheirOriginalDenominatorsAndRawOutput() async throws {
        let engine = RecipientTextFixtureEngine(overrides: [1: .partialFailure("A"), 2: .output("B.")])
        try await withFixture(engine: engine) { fixture in
            let result = try await NativeRecipientTextBenchmark.run(
                runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest
            )
            XCTAssertEqual(result.trials.count, 36)
            XCTAssertEqual(result.status, .completed)
            XCTAssertEqual(result.metrics.caseCount, 12)
            XCTAssertEqual(result.metrics.attemptedTrialCount, 36)
            XCTAssertEqual(result.metrics.completedTrialCount, 35)
            XCTAssertEqual(result.metrics.generationFailedCount, 1)
            XCTAssertEqual(result.metrics.invalidAnswerCount, 1)
            XCTAssertEqual(result.metrics.correctAnswerCount, 11)
            XCTAssertEqual(result.metrics.absentAnswerCount, 5)
            XCTAssertEqual(result.metrics.counterfactualFollowingCount, 12)
            XCTAssertEqual(result.metrics.correctAccuracy, 11.0 / 12.0)
            XCTAssertEqual(result.metrics.absentAccuracy, 5.0 / 12.0)
            XCTAssertEqual(result.metrics.correctAndCounterfactualPairCount, 11)
            XCTAssertEqual(result.trials[0].status, .generationFailed)
            XCTAssertNotNil(result.trials[0].requestId)
            XCTAssertNil(result.trials[0].rawOutput, "A thrown generation does not return its partial buffer")
            XCTAssertNil(result.trials[0].parsedAnswer)
            XCTAssertFalse(result.trials[0].scoredCorrect)
            XCTAssertNotNil(result.trials[0].errorMessage)
            XCTAssertEqual(result.trials[1].rawOutput, "B.")
            XCTAssertEqual(result.trials[1].status, .completed)
            XCTAssertNil(result.trials[1].parsedAnswer)
            XCTAssertFalse(result.trials[1].scoredCorrect)
            let drains = await engine.drainIDs()
            XCTAssertEqual(drains, [result.trials[0].requestId!.uuidString])

            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(result.trials[0])) as? [String: Any])
            XCTAssertTrue(json["rawOutput"] is NSNull)
            XCTAssertTrue(json["parsedAnswer"] is NSNull)
            XCTAssertNotNil(json["requestId"] as? String)
        }
    }

    func testOutputLimitFailureIsRecordedWithoutRetryOrFallback() async throws {
        let engine = RecipientTextFixtureEngine(overrides: [1: .output(String(repeating: "A", count: 129))])
        try await withFixture(engine: engine) { fixture in
            let result = try await NativeRecipientTextBenchmark.run(
                runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest
            )
            XCTAssertEqual(result.trials[0].status, .generationFailed)
            XCTAssertNil(result.trials[0].rawOutput)
            XCTAssertEqual(result.metrics.generationFailedCount, 1)
            XCTAssertEqual(result.metrics.attemptedTrialCount, 36)
            let requests = await engine.requests()
            XCTAssertEqual(requests.count, 36)
            let drains = await engine.drainIDs()
            XCTAssertEqual(drains.count, 1)
        }
    }

    func testBudgetExpiryPreservesEveryScheduledRowWithoutStartingMoreRequests() async throws {
        let engine = RecipientTextFixtureEngine()
        let clock = RecipientTextTestClock()
        try await withFixture(engine: engine) { fixture in
            let recorder = RecipientTextTrialRecorder()
            let result = try await NativeRecipientTextBenchmark.run(
                runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest,
                monotonicNanoseconds: { clock.now() },
                onTrial: { trial in
                    await recorder.append(trial)
                    if trial.ordinal == 1 { clock.advance(seconds: 900) }
                }
            )
            XCTAssertEqual(result.status, .budgetExceeded)
            XCTAssertEqual(result.elapsedMilliseconds, 900_000)
            XCTAssertEqual(result.trials.count, 36)
            XCTAssertEqual(result.metrics.caseCount, 12)
            XCTAssertEqual(result.metrics.attemptedTrialCount, 1)
            XCTAssertEqual(result.metrics.completedTrialCount, 1)
            XCTAssertEqual(result.metrics.notRunBudgetCount, 35)
            XCTAssertEqual(result.metrics.correctAnswerCount, 1)
            XCTAssertEqual(result.metrics.correctAccuracy, 1.0 / 12.0)
            XCTAssertTrue(result.trials.dropFirst().allSatisfy {
                $0.status == .notRunBudget && $0.requestId == nil && $0.rawOutput == nil &&
                $0.parsedAnswer == nil && !$0.scoredCorrect && $0.latencyMilliseconds == 0
            })
            let requests = await engine.requests()
            XCTAssertEqual(requests.count, 1)
            let records = await recorder.trials()
            XCTAssertEqual(records, result.trials)
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(result.trials[1])) as? [String: Any])
            XCTAssertTrue(json["requestId"] is NSNull)
            XCTAssertTrue(json["rawOutput"] is NSNull)
        }
    }

    func testBudgetIncludesCallbacksAndReportsAnOverrunAfterTheFinalRequest() async throws {
        let engine = RecipientTextFixtureEngine()
        let clock = RecipientTextTestClock()
        try await withFixture(engine: engine) { fixture in
            let result = try await NativeRecipientTextBenchmark.run(
                runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest,
                monotonicNanoseconds: { clock.now() },
                onTrial: { trial in
                    if trial.ordinal == 36 { clock.advance(seconds: 901) }
                }
            )
            XCTAssertEqual(result.status, .budgetExceeded)
            XCTAssertEqual(result.elapsedMilliseconds, 901_000)
            XCTAssertEqual(result.metrics.attemptedTrialCount, 36)
            XCTAssertEqual(result.metrics.notRunBudgetCount, 0)
        }
    }

    func testNoncanonicalDigestAndChangedModelBytesFailBeforeGeneration() async throws {
        let engine = RecipientTextFixtureEngine()
        try await withFixture(engine: engine) { fixture in
            for digest in ["", "bad", fixture.digest.uppercased(), String(repeating: "0", count: 64)] {
                do {
                    _ = try await NativeRecipientTextBenchmark.run(
                        runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: digest
                    )
                    XCTFail("A noncanonical or foreign model identity must fail preflight")
                } catch NativeRecipientTextBenchmarkError.invalidModelIdentity {
                }
            }
            try Data("changed model bytes".utf8).write(to: fixture.fileURL)
            do {
                _ = try await NativeRecipientTextBenchmark.run(
                    runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest
                )
                XCTFail("A model hash mismatch must fail before inference")
            } catch NativeRecipientTextBenchmarkError.modelArtifactMismatch {
            }
            let requests = await engine.requests()
            XCTAssertTrue(requests.isEmpty)
        }
    }

    func testModelFileIsRecheckedBeforeReturningACompletedReport() async throws {
        let engine = RecipientTextFixtureEngine()
        try await withFixture(engine: engine) { fixture in
            let recorder = RecipientTextTrialRecorder()
            do {
                _ = try await NativeRecipientTextBenchmark.run(
                    runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest,
                    onTrial: { trial in
                        await recorder.append(trial)
                        if trial.ordinal == 1 { try? Data("changed during run".utf8).write(to: fixture.fileURL) }
                    }
                )
                XCTFail("A changed artifact must invalidate the final report")
            } catch NativeRecipientTextBenchmarkError.modelArtifactMismatch {
            }
            let rows = await recorder.trials()
            XCTAssertEqual(rows.count, 36, "Already emitted rows are provisional until final model verification")
            XCTAssertNotEqual(try Data(contentsOf: fixture.fileURL), fixture.originalBytes)
        }
    }

    func testForeignAndReleasedLeasesPropagateWithoutBecomingScoredFailures() async throws {
        let engine = RecipientTextFixtureEngine()
        try await withFixture(engine: engine) { fixture in
            let foreignEngine = RecipientTextFixtureEngine()
            let foreignRuntime = try makeRuntime(engine: foreignEngine)
            do {
                _ = try await NativeRecipientTextBenchmark.run(
                    runtime: foreignRuntime, lease: fixture.lease, expectedModelSHA256: fixture.digest
                )
                XCTFail("A foreign lease must remain an admission failure")
            } catch ModelPoolError.invalidLease {
            }
            _ = await fixture.runtime.release(fixture.lease)
            do {
                _ = try await NativeRecipientTextBenchmark.run(
                    runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest
                )
                XCTFail("A released lease must remain an admission failure")
            } catch ModelPoolError.invalidLease {
            }
            let requests = await engine.requests()
            let foreignRequests = await foreignEngine.requests()
            XCTAssertTrue(requests.isEmpty)
            XCTAssertTrue(foreignRequests.isEmpty)
            await assertIdle(foreignRuntime)
        }
    }

    func testBothCancellationErrorFormsPropagateWithoutSchedulingTheRest() async throws {
        for cancellation in [RecipientTextFixtureOutcome.taskCancelled, .backendCancelled] {
            let engine = RecipientTextFixtureEngine(overrides: [1: cancellation])
            try await withFixture(engine: engine) { fixture in
                do {
                    _ = try await NativeRecipientTextBenchmark.run(
                        runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest
                    )
                    XCTFail("Cancellation must not become an ordinary failed answer")
                } catch is CancellationError {
                    XCTAssertEqual(cancellation, .taskCancelled)
                } catch LlamaEngineError.cancelled {
                    XCTAssertEqual(cancellation, .backendCancelled)
                }
                let requests = await engine.requests()
                XCTAssertEqual(requests.count, 1)
            }
        }
    }

    func testCancellationDuringCallbackStopsTheScheduleWithNoHeldInferenceResources() async throws {
        let engine = RecipientTextFixtureEngine()
        try await withFixture(engine: engine) { fixture in
            let gate = RecipientTextCallbackGate()
            let operation = Task {
                try await NativeRecipientTextBenchmark.run(
                    runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest,
                    onTrial: { await gate.receiveAndWait($0) }
                )
            }
            try await waitForRecipientTextCondition { await gate.isWaiting() }
            await assertIdle(fixture.runtime)
            operation.cancel()
            await gate.resume()
            do {
                _ = try await operation.value
                XCTFail("A cancelled callback must stop before the next model request")
            } catch is CancellationError {
            }
            let requests = await engine.requests()
            let rows = await gate.trials()
            XCTAssertEqual(requests.count, 1)
            XCTAssertEqual(rows.count, 1)
        }
    }

    func testInFlightCancellationRetainsTheRuntimePermitUntilDrainReturns() async throws {
        let engine = RecipientTextFixtureEngine(overrides: [1: .blocked], blocksDrain: true)
        try await withFixture(engine: engine) { fixture in
            let operation = Task {
                try await NativeRecipientTextBenchmark.run(
                    runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest
                )
            }
            try await waitForRecipientTextCondition { await engine.hasBlockedRequest() }
            operation.cancel()
            try await waitForRecipientTextCondition { await engine.isDrainBlocked() }
            let pool = await fixture.runtime.snapshot()
            let scheduler = await fixture.runtime.schedulerSnapshot()
            XCTAssertEqual(pool.activeUseCount, 1)
            XCTAssertEqual(scheduler.activeRequests, 1)
            await engine.releaseDrain()
            do {
                _ = try await operation.value
                XCTFail("An interrupted inference must not publish a complete benchmark")
            } catch is CancellationError {
            }
            let requests = await engine.requests()
            let drains = await engine.drainIDs()
            XCTAssertEqual(requests.count, 1)
            XCTAssertEqual(drains, [requests[0].requestId])
        }
    }

    private func withFixture(
        engine: RecipientTextFixtureEngine,
        operation: (RecipientTextRuntimeFixture) async throws -> Void
    ) async throws {
        let originalBytes = Data("host-owned synthetic recipient benchmark model fixture v1".utf8)
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("recipient-benchmark-\(UUID().uuidString).gguf")
        try originalBytes.write(to: fileURL)
        defer { try? FileManager.default.removeItem(at: fileURL) }
        let digest = NativeLatentSHA256.digest(originalBytes)
        let descriptor = ModelDescriptor(
            id: "sha256-\(digest)", name: "Fixture only", path: fileURL.path, contextLength: 512
        )
        let runtime = try makeRuntime(engine: engine)
        let lease = try await runtime.acquire(model: descriptor, estimatedMemoryMB: 128)
        let fixture = RecipientTextRuntimeFixture(
            runtime: runtime, lease: lease, fileURL: fileURL, digest: digest, originalBytes: originalBytes
        )
        do {
            try await operation(fixture)
            await assertIdle(runtime)
            _ = await runtime.release(lease)
            try await runtime.unload(modelId: descriptor.id)
            let after = await runtime.snapshot()
            XCTAssertEqual(after.reservedMemoryMB, 0)
        } catch {
            _ = await runtime.release(lease)
            try? await runtime.unload(modelId: descriptor.id)
            throw error
        }
    }

    private func makeRuntime(engine: any LlamaEngine) throws -> NativeInferenceRuntime {
        try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: ModelPoolConfiguration(
                maxResidentMemoryMB: 1_024, maxLoadedModels: 1, minimumFreeMemoryMB: 128
            ),
            availableMemoryMB: { 2_048 }, maxConcurrentRequests: 1
        )
    }

    private func assertIdle(_ runtime: NativeInferenceRuntime) async {
        let pool = await runtime.snapshot()
        let scheduler = await runtime.schedulerSnapshot()
        XCTAssertEqual(pool.activeUseCount, 0)
        XCTAssertEqual(scheduler.activeRequests, 0)
        XCTAssertEqual(scheduler.waitingRequests, 0)
    }
}

private struct RecipientTextRuntimeFixture: Sendable {
    let runtime: NativeInferenceRuntime
    let lease: ModelPoolLease
    let fileURL: URL
    let digest: String
    let originalBytes: Data
}

private enum RecipientTextFixtureOutcome: Sendable, Equatable {
    case output(String)
    case partialFailure(String)
    case taskCancelled
    case backendCancelled
    case blocked
}

/// The oracle reads only the literal message and options in the supplied prompt.
/// It has no access to case IDs, condition metadata, or the host's answer keys.
private actor RecipientTextFixtureEngine: LlamaEngine {
    private let defaultOutput: String?
    private let overrides: [Int: RecipientTextFixtureOutcome]
    private let blocksDrain: Bool
    private var calls: [GenerationRequest] = []
    private var drainRequests: [String] = []
    private var blockedContinuation: AsyncThrowingStream<Token, Error>.Continuation?
    private var drainContinuation: CheckedContinuation<Void, Never>?

    init(defaultOutput: String? = nil, overrides: [Int: RecipientTextFixtureOutcome] = [:], blocksDrain: Bool = false) {
        self.defaultOutput = defaultOutput
        self.overrides = overrides
        self.blocksDrain = blocksDrain
    }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        calls.append(request)
        let outcome = overrides[calls.count] ?? .output(defaultOutput ?? answerFromMessage(request.prompt))
        switch outcome {
        case .taskCancelled: throw CancellationError()
        case .backendCancelled: throw LlamaEngineError.cancelled
        case .blocked:
            var captured: AsyncThrowingStream<Token, Error>.Continuation?
            let stream = AsyncThrowingStream<Token, Error> { captured = $0 }
            blockedContinuation = captured
            return stream
        case .output(let output):
            return AsyncThrowingStream { continuation in
                continuation.yield(Token(text: output, isComplete: true))
                continuation.finish()
            }
        case .partialFailure(let partial):
            return AsyncThrowingStream { continuation in
                continuation.yield(Token(text: partial, isComplete: false))
                continuation.finish(throwing: LlamaEngineError.backendFailed("fixture failure after partial output"))
            }
        }
    }

    func cancel(sessionId: String, requestId: String) async {
        blockedContinuation?.finish(throwing: CancellationError())
        blockedContinuation = nil
    }

    func cancelAndWait(sessionId: String, requestId: String) async {
        drainRequests.append(requestId)
        blockedContinuation?.finish(throwing: CancellationError())
        blockedContinuation = nil
        if blocksDrain { await withCheckedContinuation { drainContinuation = $0 } }
    }

    func unload(sessionId: String) async {}
    func requests() -> [GenerationRequest] { calls }
    func drainIDs() -> [String] { drainRequests }
    func hasBlockedRequest() -> Bool { blockedContinuation != nil }
    func isDrainBlocked() -> Bool { drainContinuation != nil }
    func releaseDrain() { drainContinuation?.resume(); drainContinuation = nil }

    private func answerFromMessage(_ prompt: String) -> String {
        let lines = prompt.components(separatedBy: "\n")
        let message = lines.first { $0.hasPrefix("Message: ") } ?? ""
        let optionA = lines.first { $0.hasPrefix("A: ") }.map { String($0.dropFirst(3)) } ?? ""
        let word: String?
        if message.hasSuffix(" is cedar.") { word = "cedar" }
        else if message.hasSuffix(" is maple.") { word = "maple" }
        else { word = nil }
        let answer = word.map { $0 == optionA ? "A" : "B" } ?? "A"
        return "\t\(answer)\r\n"
    }
}

private actor RecipientTextTrialRecorder {
    private var rows: [NativeRecipientTextTrial] = []
    func append(_ trial: NativeRecipientTextTrial) { rows.append(trial) }
    func trials() -> [NativeRecipientTextTrial] { rows }
}

private actor RecipientTextCallbackGate {
    private var rows: [NativeRecipientTextTrial] = []
    private var continuation: CheckedContinuation<Void, Never>?
    func receiveAndWait(_ trial: NativeRecipientTextTrial) async {
        rows.append(trial)
        await withCheckedContinuation { continuation = $0 }
    }
    func isWaiting() -> Bool { continuation != nil }
    func trials() -> [NativeRecipientTextTrial] { rows }
    func resume() { continuation?.resume(); continuation = nil }
}

private final class RecipientTextTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var nanoseconds: UInt64 = 0
    func now() -> UInt64 {
        lock.lock()
        defer { lock.unlock() }
        return nanoseconds
    }
    func advance(seconds: UInt64) {
        lock.lock()
        defer { lock.unlock() }
        nanoseconds += seconds * 1_000_000_000
    }
}

private func waitForRecipientTextCondition(
    timeout: TimeInterval = 15,
    file: StaticString = #filePath,
    line: UInt = #line,
    _ condition: () async -> Bool
) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while !(await condition()) {
        guard Date() < deadline else {
            XCTFail("Timed out waiting for recipient benchmark fixture state", file: file, line: line)
            throw RecipientTextTestWaitTimeout()
        }
        try await Task.sleep(nanoseconds: 10_000_000)
    }
}

private struct RecipientTextTestWaitTimeout: Error {}

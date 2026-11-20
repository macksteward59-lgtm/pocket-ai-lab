import Foundation
import XCTest
@testable import PocketLlamaEngine

final class RecipientFormatCalibrationContractTests: XCTestCase {
    func testFrozenManifestAndLiteralTemplateExpansion() throws {
        let bytes = try RecipientFormatCalibration.manifestData()
        XCTAssertEqual(bytes.count, 44_072)
        let manifest = try RecipientFormatCalibration.loadManifest(data: bytes)
        XCTAssertEqual(manifest.trials.count, 72)
        XCTAssertEqual(manifest.trials[0].format, "raw")
        XCTAssertEqual(manifest.trials[1].format, "chat")
        XCTAssertEqual(manifest.trials[2].format, "chat")
        let literal = "<|im_start|>system\nYou are a helpful AI assistant named SmolLM, trained by Hugging Face<|im_end|>\n" +
            "<|im_start|>user\nRead the message and answer the question.\n" +
            "Message: The stored word for OBJ-AB40EC30 is cedar.\n" +
            "Question: Which word is stored for OBJ-AB40EC30?\nA: cedar\nB: maple\n" +
            "Reply with exactly A or B.\nAnswer:<|im_end|>\n<|im_start|>assistant\n"
        XCTAssertEqual(manifest.trials[1].prompt, literal)
        XCTAssertEqual(manifest.template.utf8ByteLength, 368)
        XCTAssertEqual(manifest.trials.filter { $0.format == "chat" }.count, 36)
        XCTAssertEqual(manifest.trials.filter { $0.format == "raw" }.count, 36)
        XCTAssertEqual(stride(from: 0, to: 72, by: 2).filter { manifest.trials[$0].format == "raw" }.count, 18)
        var changed = bytes
        changed.append(0x0A)
        XCTAssertThrowsError(try RecipientFormatCalibration.loadManifest(data: changed))
        XCTAssertEqual(NativeRecipientTextBenchmark.manifestSHA256,
                       "376b9eef0c0b6b935307a4e9b2ce48ad5780281a1944394ac7a174a40ca3a51d")
    }

    func testAllFrozenRequestsReachExistingRuntimeUnchanged() async throws {
        let engine = FormatFixtureEngine()
        try await withFixture(engine) { fixture in
            let run = try await RecipientFormatCalibration.run(runtime: fixture.runtime, lease: fixture.lease,
                                                               expectedModelSHA256: fixture.digest)
            let manifest = try RecipientFormatCalibration.loadManifest()
            let calls = await engine.requests()
            XCTAssertEqual(fixture.runtime.providerKind, .other)
            XCTAssertEqual(calls.count, 72)
            XCTAssertEqual(calls.map(\.prompt), manifest.trials.map(\.prompt))
            XCTAssertTrue(calls.allSatisfy { $0.maxTokens == 4 && $0.temperature == 0 })
            XCTAssertEqual(Set(calls.map(\.requestId)).count, 72)
            XCTAssertEqual(run.trials.map { $0.requestId?.uuidString }, calls.map { Optional($0.requestId) })
            XCTAssertEqual(run.status, "completed")
            XCTAssertTrue(run.trials.allSatisfy { $0.rawOutput == " A\n" && $0.parsedAnswer == "A" })
            XCTAssertEqual(run.trials.filter(\.scoredCorrect).count, 36)
        }
    }

    func testFailuresAndInvalidOutputStaySeparateWithoutRetries() async throws {
        let engine = FormatFixtureEngine(overrides: [1: .partialFailure, 2: .text("A."), 3: .text("\u{00a0}A"), 4: .text(String(repeating: "x", count: 129))])
        try await withFixture(engine) { fixture in
            let run = try await RecipientFormatCalibration.run(runtime: fixture.runtime, lease: fixture.lease,
                                                               expectedModelSHA256: fixture.digest)
            let calls = await engine.requests()
            XCTAssertEqual(calls.count, 72)
            XCTAssertEqual(run.trials[0].status, "generationFailed")
            XCTAssertNil(run.trials[0].rawOutput)
            XCTAssertNotNil(run.trials[0].errorMessage)
            XCTAssertEqual(run.trials[1].rawOutput, "A.")
            XCTAssertEqual(run.trials[1].status, "completed")
            XCTAssertNil(run.trials[1].parsedAnswer)
            XCTAssertNil(run.trials[2].parsedAnswer)
            XCTAssertEqual(run.trials[3].status, "generationFailed")
            XCTAssertNil(run.trials[3].rawOutput)
            XCTAssertFalse(run.trials[0].scoredCorrect)
            let encoded = try JSONEncoder().encode(run.trials[0])
            let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
            XCTAssertTrue(object["rawOutput"] is NSNull)
            XCTAssertTrue(object["parsedAnswer"] is NSNull)
        }
    }

    func testBudgetKeepsAllRowsAndDoesNotStartRemainingRequests() async throws {
        let engine = FormatFixtureEngine()
        let clock = FormatFixtureClock()
        try await withFixture(engine) { fixture in
            let run = try await RecipientFormatCalibration.run(
                runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest,
                clock: { clock.read() }, onTrial: { _ in clock.advanceTo(901_000_000_000) }
            )
            let calls = await engine.requests()
            XCTAssertEqual(calls.count, 1)
            XCTAssertEqual(run.trials.count, 72)
            XCTAssertEqual(run.status, "budgetExceeded")
            XCTAssertEqual(run.trials.filter { $0.status == "notRunBudget" }.count, 71)
            XCTAssertTrue(run.trials.dropFirst().allSatisfy { $0.requestId == nil && $0.rawOutput == nil && !$0.scoredCorrect })
        }
    }

    func testCancellationIsPropagatedWithoutSchedulingOtherRows() async throws {
        for outcome in [FormatFixtureOutcome.taskCancellation, .nativeCancellation] {
            let engine = FormatFixtureEngine(overrides: [1: outcome])
            try await withFixture(engine) { fixture in
                do {
                    _ = try await RecipientFormatCalibration.run(runtime: fixture.runtime, lease: fixture.lease,
                                                                 expectedModelSHA256: fixture.digest)
                    XCTFail("Cancellation must propagate.")
                } catch is CancellationError {
                    XCTAssertEqual(outcome, .taskCancellation)
                } catch LlamaEngineError.cancelled {
                    XCTAssertEqual(outcome, .nativeCancellation)
                }
                let calls = await engine.requests()
                XCTAssertEqual(calls.count, 1)
            }
        }
    }

    func testChangedModelArtifactIsRejectedBeforeRequestsAndAfterCallbacks() async throws {
        let engine = FormatFixtureEngine()
        try await withFixture(engine) { fixture in
            try Data("different fixture".utf8).write(to: fixture.url)
            do {
                _ = try await RecipientFormatCalibration.run(runtime: fixture.runtime, lease: fixture.lease,
                                                             expectedModelSHA256: fixture.digest)
                XCTFail("Changed artifact must fail preflight.")
            } catch NativeRecipientTextBenchmarkError.modelArtifactMismatch {}
            let beforeCalls = await engine.requests()
            XCTAssertTrue(beforeCalls.isEmpty)
            try fixture.original.write(to: fixture.url)
            do {
                _ = try await RecipientFormatCalibration.run(
                    runtime: fixture.runtime, lease: fixture.lease, expectedModelSHA256: fixture.digest,
                    onTrial: { row in
                        if row.ordinal == 72 { try Data("changed after generation".utf8).write(to: fixture.url) }
                    }
                )
                XCTFail("Changed artifact must fail final verification.")
            } catch NativeRecipientTextBenchmarkError.modelArtifactMismatch {}
        }
    }

    func testReleasedLeaseDoesNotBecomeAnOrdinaryMeasuredError() async throws {
        let engine = FormatFixtureEngine()
        try await withFixture(engine) { fixture in
            _ = await fixture.runtime.release(fixture.lease)
            do {
                _ = try await RecipientFormatCalibration.run(runtime: fixture.runtime, lease: fixture.lease,
                                                             expectedModelSHA256: fixture.digest)
                XCTFail("Invalid lease must propagate.")
            } catch is ModelPoolError {}
            let calls = await engine.requests()
            XCTAssertTrue(calls.isEmpty)
        }
    }

    private func withFixture(_ engine: FormatFixtureEngine, operation: (FormatFixture) async throws -> Void) async throws {
        let original = Data("Declared synthetic model for format-runner contract tests.".utf8)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("format-fixture-\(UUID().uuidString).gguf")
        try original.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let digest = NativeLatentSHA256.digest(original)
        let model = ModelDescriptor(id: "sha256-" + digest, name: "Fixture only", path: url.path, contextLength: 512)
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: ModelPoolConfiguration(maxResidentMemoryMB: 1_024, maxLoadedModels: 1, minimumFreeMemoryMB: 0),
            availableMemoryMB: { 2_048 }, maxConcurrentRequests: 1
        )
        let lease = try await runtime.acquire(model: model, estimatedMemoryMB: 128)
        do {
            try await operation(FormatFixture(runtime: runtime, lease: lease, url: url, digest: digest, original: original))
            let pool = await runtime.snapshot()
            let scheduler = await runtime.schedulerSnapshot()
            XCTAssertEqual(pool.activeUseCount, 0)
            XCTAssertEqual(scheduler.activeRequests, 0)
            XCTAssertEqual(scheduler.waitingRequests, 0)
            _ = await runtime.release(lease)
            try await runtime.unload(modelId: model.id)
        } catch {
            _ = await runtime.release(lease)
            try? await runtime.unload(modelId: model.id)
            throw error
        }
    }
}

private struct FormatFixture: Sendable {
    let runtime: NativeInferenceRuntime
    let lease: ModelPoolLease
    let url: URL
    let digest: String
    let original: Data
}

private enum FormatFixtureOutcome: Equatable, Sendable {
    case text(String)
    case partialFailure
    case taskCancellation
    case nativeCancellation
}

private actor FormatFixtureEngine: LlamaEngine {
    let overrides: [Int: FormatFixtureOutcome]
    private var calls: [GenerationRequest] = []
    init(overrides: [Int: FormatFixtureOutcome] = [:]) { self.overrides = overrides }
    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }
    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        calls.append(request)
        let outcome = overrides[calls.count] ?? .text(" A\n")
        switch outcome {
        case .taskCancellation: throw CancellationError()
        case .nativeCancellation: throw LlamaEngineError.cancelled
        case .text(let text):
            return AsyncThrowingStream { continuation in
                continuation.yield(Token(text: text, isComplete: true))
                continuation.finish()
            }
        case .partialFailure:
            return AsyncThrowingStream { continuation in
                continuation.yield(Token(text: "A", isComplete: false))
                continuation.finish(throwing: LlamaEngineError.backendFailed("Declared fixture partial failure"))
            }
        }
    }
    func requests() -> [GenerationRequest] { calls }
    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
}

private final class FormatFixtureClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 0
    func read() -> UInt64 { lock.lock(); defer { lock.unlock() }; return value }
    func advanceTo(_ next: UInt64) { lock.lock(); defer { lock.unlock() }; value = next }
}

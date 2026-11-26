import Foundation
import XCTest
@testable import PocketLlamaEngine

final class DeepSeekQualificationContractTests: XCTestCase {
    func testProfileBoundsAndExactPromptConstruction() throws {
        let fixtureBytes = Data("Declared synthetic DeepSeek qualification fixture model.".utf8)
        let loaded = try Self.profile(for: fixtureBytes)
        let profile = loaded.profile
        XCTAssertEqual(profile.prompt(for: profile.cases[0]), "<｜User｜>Return the fixture answer.<｜Assistant｜><think>\n")
        XCTAssertFalse(profile.prompt(for: profile.cases[0]).contains("<｜begin▁of▁sentence｜>"))
        let original = try JSONEncoder().encode(profile)
        let checked = try DeepSeekQualification.loadProfile(data: original)
        XCTAssertEqual(checked.sha256, DeepSeekQualification.sha256(original))
        var changedBytes = original
        changedBytes.append(0x0A)
        XCTAssertNotEqual(try DeepSeekQualification.loadProfile(data: changedBytes).sha256, checked.sha256)
        XCTAssertThrowsError(try DeepSeekQualification.requirePinnedModel(profile))
        for change in ["context", "tokens", "duration", "chat", "runtime", "duplicates", "large-prompt"] {
            var object = try XCTUnwrap(JSONSerialization.jsonObject(with: original) as? [String: Any])
            if ["context", "tokens", "duration"].contains(change) {
                var settings = try XCTUnwrap(object["settings"] as? [String: Any])
                settings[change == "context" ? "contextLength" : change == "tokens" ? "maxTokens" : "maximumDurationSeconds"] = 999_999
                object["settings"] = settings
            } else if change == "chat" {
                object["chat"] = ["prefix": "<｜begin▁of▁sentence｜><｜User｜>", "suffix": "<｜Assistant｜><think>\n"]
            } else if change == "runtime" {
                object["runtime"] = ["tag": "unverified", "commit": String(repeating: "0", count: 40)]
            } else {
                var cases = try XCTUnwrap(object["cases"] as? [[String: Any]])
                if change == "duplicates" { cases[1]["id"] = cases[0]["id"] }
                else { cases[0]["prompt"] = String(repeating: "x", count: 4_096) }
                object["cases"] = cases
            }
            XCTAssertThrowsError(try DeepSeekQualification.loadProfile(data: JSONSerialization.data(withJSONObject: object)), change)
        }
        XCTAssertThrowsError(try DeepSeekQualification.loadProfile(data: Data(repeating: 32, count: DeepSeekQualification.maximumProfileBytes + 1)))
    }

    func testFinalParserRejectsReasoningRepairDuplicatesAndExtraContent() {
        XCTAssertEqual(DeepSeekQualification.parseFinalAnswer("A considered response.</think> \n{\"answer\":\"A\"}\t"), "A")
        XCTAssertEqual(DeepSeekQualification.parseFinalAnswer("</think>{\"answer\":\"quote \\\" and \\uD83D\\uDE00\"}"), "quote \" and 😀")
        XCTAssertEqual(DeepSeekQualification.parseFinalAnswer("</think>{\"\\u0061nswer\":\"A\"}"), "A")
        for raw in [
            "{\"answer\":\"A\"}",
            "<think>reasoning</think>{\"answer\":\"A\"}",
            "reasoning</think></think>{\"answer\":\"A\"}",
            "{\"answer\":\"A\"} reasoning continues",
            "reasoning</think>```json\n{\"answer\":\"A\"}\n```",
            "reasoning</think>Here is the answer: {\"answer\":\"A\"}",
            "reasoning</think>{\"answer\":\"A\"} trailing prose",
            "reasoning</think>{\"answer\":\"A\"}{\"answer\":\"A\"}",
            "reasoning</think>{\"answer\":\"A\",\"answer\":\"B\"}",
            "reasoning</think>{\"answer\":\"A\",\"\\u0061nswer\":\"B\"}",
            "reasoning</think>{\"answer\":\"A\",\"extra\":true}",
            "reasoning</think>{\"answer\":42}",
            "reasoning</think>[{\"answer\":\"A\"}]",
            "reasoning</think>{\"answer\":\"\\uD800\"}",
            "reasoning</think>{\"answer\":\"\\uDC00\"}",
            "reasoning</think>{\"answer\":\"unescaped\nnewline\"}",
            "reasoning</think>{\"answer\":\"A\",}",
            "reasoning</think>\u{00A0}{\"answer\":\"A\"}",
            String(repeating: "x", count: 16_384) + "</think>{\"answer\":\"A\"}"
        ] {
            XCTAssertNil(DeepSeekQualification.parseFinalAnswer(raw), raw)
        }
    }

    func testAllRequestsUseExistingRuntimeAndRetainCorrectnessSeparately() async throws {
        let engine = DeepSeekQualificationFixtureEngine(overrides: [2: .text("reasoning</think>{\"answer\":\"B\"}")])
        try await withFixture(engine) { fixture in
            let run = try await DeepSeekQualification.run(runtime: fixture.runtime, lease: fixture.lease,
                loadedProfile: fixture.loaded, peakRSS: { 12_345 })
            let calls = await engine.requests()
            XCTAssertEqual(fixture.runtime.providerKind, .other)
            XCTAssertEqual(calls.count, 8)
            XCTAssertEqual(calls.map(\.prompt), fixture.loaded.profile.cases.map { fixture.loaded.profile.prompt(for: $0) })
            XCTAssertTrue(calls.allSatisfy { $0.maxTokens == 512 && $0.temperature == 0 })
            XCTAssertEqual(Set(calls.map(\.requestId)).count, 8)
            XCTAssertEqual(run.trials.map { $0.requestID?.uuidString }, calls.map { Optional($0.requestId) })
            XCTAssertEqual(run.status, "completed")
            XCTAssertEqual(run.trials.filter(\.validFinalJSON).count, 8)
            XCTAssertEqual(run.trials.filter(\.scoredCorrect).count, 7)
            XCTAssertTrue(run.trials.allSatisfy { $0.processPeakRSSBytes == 12_345 })
            XCTAssertEqual(run.trials[0].promptSHA256, DeepSeekQualification.sha256(Data(calls[0].prompt.utf8)))
            let json = try XCTUnwrap(DeepSeekQualification.jsonObject(run.trials[0]) as? [String: Any])
            for field in ["errorMessage", "finishReason", "tokenCount", "timeToFirstTokenMilliseconds"] {
                XCTAssertTrue(json[field] is NSNull, field)
            }
        }
    }

    func testMalformedPartialAndFailedGenerationsRemainEvidenceWithoutRetries() async throws {
        let engine = DeepSeekQualificationFixtureEngine(overrides: [
            1: .partialFailure, 2: .failure, 3: .text("unfinished reasoning"),
            4: .text(String(repeating: "x", count: 16_385)), 5: .text("")
        ])
        try await withFixture(engine) { fixture in
            let run = try await DeepSeekQualification.run(runtime: fixture.runtime, lease: fixture.lease, loadedProfile: fixture.loaded)
            let calls = await engine.requests()
            XCTAssertEqual(calls.count, 8)
            XCTAssertEqual(run.status, "completed", "Measurement completeness is separate from model quality.")
            XCTAssertEqual(run.trials[0].status, "partial")
            XCTAssertEqual(run.trials[0].rawOutput, "partial reasoning</think>{\"answer\":\"A\"}")
            XCTAssertEqual(run.trials[0].parsedAnswer, "A")
            XCTAssertTrue(run.trials[0].validFinalJSON)
            XCTAssertFalse(run.trials[0].scoredCorrect)
            XCTAssertNotNil(run.trials[0].errorMessage)
            XCTAssertEqual(run.trials[1].status, "failed")
            XCTAssertEqual(run.trials[1].rawOutput, "")
            XCTAssertEqual(run.trials[2].status, "completed")
            XCTAssertEqual(run.trials[2].rawOutput, "unfinished reasoning")
            XCTAssertEqual(run.trials[3].status, "failed")
            XCTAssertEqual(run.trials[4].status, "failed")
            XCTAssertTrue(run.trials.prefix(5).allSatisfy { !$0.scoredCorrect })
            XCTAssertTrue(run.trials[1..<5].allSatisfy { !$0.validFinalJSON })
            XCTAssertEqual(run.trials.filter(\.validFinalJSON).count, 4)
            XCTAssertEqual(run.trials.filter(\.scoredCorrect).count, 3)
            let drains = await engine.cancellationDrains()
            XCTAssertGreaterThanOrEqual(drains, 2)
        }
    }

    func testBudgetRetainsEightRowsWithoutStartingRemainingRequests() async throws {
        let engine = DeepSeekQualificationFixtureEngine()
        let clock = DeepSeekQualificationFixtureClock()
        try await withFixture(engine) { fixture in
            let run = try await DeepSeekQualification.run(runtime: fixture.runtime, lease: fixture.lease,
                loadedProfile: fixture.loaded, clock: { clock.read() },
                onTrial: { _ in clock.advance(to: 901_000_000_000) })
            let calls = await engine.requests()
            XCTAssertEqual(calls.count, 1)
            XCTAssertEqual(run.status, "budgetExceeded")
            XCTAssertEqual(run.trials.count, 8)
            XCTAssertEqual(run.trials.filter { $0.status == "notRunBudget" }.count, 7)
            XCTAssertTrue(run.trials.dropFirst().allSatisfy { $0.requestID == nil && $0.rawOutput == nil && !$0.scoredCorrect })
            let json = try XCTUnwrap(DeepSeekQualification.jsonObject(run.trials[1]) as? [String: Any])
            XCTAssertTrue(json["requestID"] is NSNull)
            XCTAssertTrue(json["rawOutput"] is NSNull)
            XCTAssertTrue(json["parsedAnswer"] is NSNull)
        }
    }

    func testCancellationPropagatesAndDoesNotScheduleAnotherRequest() async throws {
        for outcome in [DeepSeekQualificationFixtureOutcome.taskCancellation, .nativeCancellation] {
            let engine = DeepSeekQualificationFixtureEngine(overrides: [1: outcome])
            try await withFixture(engine) { fixture in
                do {
                    _ = try await DeepSeekQualification.run(runtime: fixture.runtime, lease: fixture.lease, loadedProfile: fixture.loaded)
                    XCTFail("Cancellation cannot become ordinary model-quality data.")
                } catch is CancellationError {
                    XCTAssertEqual(outcome, .taskCancellation)
                } catch LlamaEngineError.cancelled {
                    XCTAssertEqual(outcome, .nativeCancellation)
                }
                let calls = await engine.requests()
                XCTAssertEqual(calls.count, 1)
            }
        }
        let engine = DeepSeekQualificationFixtureEngine()
        try await withFixture(engine) { fixture in
            let child = Task {
                try await DeepSeekQualification.run(runtime: fixture.runtime, lease: fixture.lease,
                    loadedProfile: fixture.loaded, onTrial: { _ in withUnsafeCurrentTask { $0?.cancel() } })
            }
            do { _ = try await child.value; XCTFail("Cancelled caller must stop the runner.") }
            catch is CancellationError {}
            let calls = await engine.requests()
            XCTAssertEqual(calls.count, 1)
        }
    }

    func testModelIdentityChangesFailBeforeRequestsAndAfterCallback() async throws {
        let engine = DeepSeekQualificationFixtureEngine()
        try await withFixture(engine) { fixture in
            var changed = fixture.original
            changed[0] ^= 1
            try changed.write(to: fixture.url)
            do {
                _ = try await DeepSeekQualification.run(runtime: fixture.runtime, lease: fixture.lease, loadedProfile: fixture.loaded)
                XCTFail("Changed model must fail before inference.")
            } catch DeepSeekQualificationError.modelArtifactMismatch {}
            let callsBefore = await engine.requests()
            XCTAssertTrue(callsBefore.isEmpty)
            try fixture.original.write(to: fixture.url)
            do {
                _ = try await DeepSeekQualification.run(runtime: fixture.runtime, lease: fixture.lease,
                    loadedProfile: fixture.loaded, onTrial: { row in
                        if row.ordinal == 8 { try Data("mutated artifact".utf8).write(to: fixture.url) }
                    })
                XCTFail("Changed model must fail final verification.")
            } catch DeepSeekQualificationError.modelArtifactMismatch {}
        }
    }

    func testForeignLeaseIsNotReportedAsAnOrdinaryGenerationFailure() async throws {
        let engine = DeepSeekQualificationFixtureEngine()
        try await withFixture(engine) { fixture in
            let foreign = ModelPoolLease(leaseId: UUID().uuidString, model: fixture.lease.model,
                                         session: fixture.lease.session, estimatedMemoryMB: fixture.lease.estimatedMemoryMB)
            do {
                _ = try await DeepSeekQualification.run(runtime: fixture.runtime, lease: foreign, loadedProfile: fixture.loaded)
                XCTFail("Foreign lease must fail before inference.")
            } catch ModelPoolError.invalidLease {}
            let calls = await engine.requests()
            XCTAssertTrue(calls.isEmpty)
        }
    }

    private static func profile(for bytes: Data) throws -> DeepSeekQualificationLoadedProfile {
        let profile = DeepSeekQualificationProfile(
            schemaVersion: 1, id: "declared-fixture-profile",
            model: .init(id: "declared-fixture", filename: "fixture.gguf", sha256: DeepSeekQualification.sha256(bytes), bytes: bytes.count),
            runtime: .init(tag: DeepSeekQualification.pinTag, commit: DeepSeekQualification.pinCommit),
            settings: .init(contextLength: 2_048, maxTokens: 512, temperature: 0, maxOutputBytes: 16_384, maximumDurationSeconds: 900),
            chat: .init(prefix: "<｜User｜>", suffix: "<｜Assistant｜><think>\n"),
            cases: (1...8).map { .init(id: "fixture-\($0)", prompt: "Return the fixture answer.", expectedAnswer: "A") }
        )
        return try DeepSeekQualification.loadProfile(data: JSONEncoder().encode(profile))
    }

    private func withFixture(
        _ engine: DeepSeekQualificationFixtureEngine,
        operation: (DeepSeekQualificationFixture) async throws -> Void
    ) async throws {
        let original = Data("Declared synthetic DeepSeek qualification fixture model.".utf8)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("deepseek-fixture-\(UUID().uuidString).gguf")
        try original.write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let loaded = try Self.profile(for: original)
        let model = ModelDescriptor(id: "sha256-" + loaded.profile.model.sha256, name: "Declared fixture only", path: url.path, contextLength: 2_048)
        let runtime = try NativeInferenceRuntime(engine: engine,
            poolConfiguration: ModelPoolConfiguration(maxResidentMemoryMB: 1_024, maxLoadedModels: 1, minimumFreeMemoryMB: 0),
            availableMemoryMB: { 2_048 }, maxConcurrentRequests: 1)
        let lease = try await runtime.acquire(model: model, estimatedMemoryMB: 128)
        do {
            try await operation(DeepSeekQualificationFixture(runtime: runtime, lease: lease, loaded: loaded, url: url, original: original))
        } catch {
            let cleanup = try await DeepSeekQualification.cleanup(runtime: runtime, lease: lease)
            XCTAssertTrue(cleanup.isClean)
            throw error
        }
        let cleanup = try await DeepSeekQualification.cleanup(runtime: runtime, lease: lease)
        XCTAssertEqual(cleanup.activeLeaseCountBeforeRelease, 1)
        XCTAssertEqual(cleanup.activeUseCountBeforeRelease, 0)
        XCTAssertEqual(cleanup.activeRequestsBeforeRelease, 0)
        XCTAssertEqual(cleanup.waitingRequestsBeforeRelease, 0)
        XCTAssertTrue(cleanup.isClean)
        let unloads = await engine.unloads()
        XCTAssertEqual(unloads, 1)
    }
}

private struct DeepSeekQualificationFixture: Sendable {
    let runtime: NativeInferenceRuntime
    let lease: ModelPoolLease
    let loaded: DeepSeekQualificationLoadedProfile
    let url: URL
    let original: Data
}

private enum DeepSeekQualificationFixtureOutcome: Equatable, Sendable {
    case text(String)
    case partialFailure
    case failure
    case taskCancellation
    case nativeCancellation
}

private actor DeepSeekQualificationFixtureEngine: LlamaEngine {
    let overrides: [Int: DeepSeekQualificationFixtureOutcome]
    private var calls: [GenerationRequest] = []
    private var drainCount = 0
    private var unloadCount = 0
    init(overrides: [Int: DeepSeekQualificationFixtureOutcome] = [:]) { self.overrides = overrides }
    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }
    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        calls.append(request)
        switch overrides[calls.count] ?? .text("reasoning</think>{\"answer\":\"A\"}") {
        case .taskCancellation: throw CancellationError()
        case .nativeCancellation: throw LlamaEngineError.cancelled
        case .failure: throw LlamaEngineError.backendFailed("Declared fixture generation failure")
        case .text(let text):
            return AsyncThrowingStream { continuation in
                continuation.yield(Token(text: text, isComplete: true))
                continuation.finish()
            }
        case .partialFailure:
            return AsyncThrowingStream { continuation in
                continuation.yield(Token(text: "partial reasoning</think>{\"answer\":\"A\"}", isComplete: false))
                continuation.finish(throwing: LlamaEngineError.backendFailed("Declared fixture partial failure"))
            }
        }
    }
    func requests() -> [GenerationRequest] { calls }
    func cancellationDrains() -> Int { drainCount }
    func unloads() -> Int { unloadCount }
    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async { drainCount += 1 }
    func unload(sessionId: String) async { unloadCount += 1 }
}

private final class DeepSeekQualificationFixtureClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 0
    func read() -> UInt64 { lock.lock(); defer { lock.unlock() }; return value }
    func advance(to next: UInt64) { lock.lock(); defer { lock.unlock() }; value = next }
}

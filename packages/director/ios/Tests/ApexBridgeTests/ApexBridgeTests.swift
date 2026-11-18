import Foundation
import CryptoKit
import XCTest
import PocketLlamaEngine
import ApexBridge

final class BridgeGateTests: XCTestCase {
    func testHTTPSOriginIncludesEffectivePort() {
        XCTAssertTrue(BridgeGate.sameOrigin(
            URL(string: "https://workspace.example.test:443/app")!,
            trusted: URL(string: "https://workspace.example.test")!
        ))
        XCTAssertFalse(BridgeGate.sameOrigin(
            URL(string: "https://workspace.example.test:8443/app")!,
            trusted: URL(string: "https://workspace.example.test")!
        ))
        XCTAssertFalse(BridgeGate.sameOrigin(
            URL(string: "https://user:password@workspace.example.test/app")!,
            trusted: URL(string: "https://workspace.example.test")!
        ))
    }

    func testRemoteHTTPIsRejectedButLoopbackHTTPIsAllowed() {
        XCTAssertFalse(BridgeGate.sameOrigin(
            URL(string: "http://workspace.example.test")!,
            trusted: URL(string: "http://workspace.example.test")!
        ))
        XCTAssertTrue(BridgeGate.sameOrigin(
            URL(string: "http://localhost:8080/app")!,
            trusted: URL(string: "http://localhost:8080")!
        ))
    }

    func testGenerateRequiresExplicitChallengeAndExactSchema() {
        let page = URL(string: "https://workspace.example.test/app")!
        let trusted = URL(string: "https://workspace.example.test")!
        let body: [String: Any] = [
            "id": UUID().uuidString,
            "action": "generate",
            "sessionId": UUID().uuidString,
            "prompt": "Explain this task",
            "requestId": UUID().uuidString,
            "conversationRequestId": "conversation-1",
            "attemptId": "attempt-1",
            "challengeNonce": "0123456789abcdef"
        ]
        XCTAssertEqual(BridgeGate.parse(body, page: page, trusted: trusted), .accepted)

        var shortNonce = body
        shortNonce["challengeNonce"] = "short"
        XCTAssertEqual(BridgeGate.parse(shortNonce, page: page, trusted: trusted), .invalidMessage)

        var extraKey = body
        extraKey["privateKey"] = "must-not-cross-the-bridge"
        XCTAssertEqual(BridgeGate.parse(extraKey, page: page, trusted: trusted), .invalidMessage)
    }

    func testConsequentialActionsRemainBlockedUntilNativeApprovalCoordinatorExists() {
        let page = URL(string: "https://workspace.example.test")!
        let trusted = page
        let actions: [[String: Any]] = [
            ["id": UUID().uuidString, "action": "importModel", "model": "local-model-1", "artifactId": "artifact-1"],
            ["id": UUID().uuidString, "action": "loadModel", "model": "local-model-1"],
            ["id": UUID().uuidString, "action": "unloadModel", "sessionId": UUID().uuidString]
        ]
        for body in actions {
            XCTAssertEqual(
                BridgeGate.parse(body, page: page, trusted: trusted),
                .authorizationRequired
            )
        }
    }

    func testUntrustedOriginAndMissingRequiredFieldsFailClosed() {
        let trusted = URL(string: "https://workspace.example.test")!
        let foreign = URL(string: "https://attacker.example.test")!
        let body: [String: Any] = ["id": UUID().uuidString, "action": "getRuntimeStatus"]
        XCTAssertEqual(BridgeGate.parse(body, page: foreign, trusted: trusted), .untrustedOrigin)
        XCTAssertEqual(BridgeGate.parse(["id": UUID().uuidString, "action": "generate"], page: trusted, trusted: trusted), .invalidMessage)
    }
}

private final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Date

    init(_ value: Date) { self.value = value }

    func now() -> Date {
        lock.lock()
        defer { lock.unlock() }
        return value
    }

    func advance(_ interval: TimeInterval) {
        lock.lock()
        value = value.addingTimeInterval(interval)
        lock.unlock()
    }
}

private actor StubLlamaEngine: ApexBridge.LlamaEngine {
    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        let text = request.prompt.contains("readiness probe") ? "ready" : "answer"
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: text, isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
}


private actor SlowLlamaEngine: ApexBridge.LlamaEngine {
    private var drainedRequests: Set<String> = []

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        if request.prompt.contains("readiness probe") {
            return AsyncThrowingStream { continuation in
                continuation.yield(Token(text: "ready", isComplete: true))
                continuation.finish()
            }
        }
        return AsyncThrowingStream { continuation in
            let producer = Task {
                do {
                    try await Task.sleep(nanoseconds: 5_000_000_000)
                    continuation.yield(Token(text: "late", isComplete: true))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in producer.cancel() }
        }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {
        drainedRequests.insert(requestId)
    }
    func unload(sessionId: String) async {}
    func wasDrained(_ requestId: String) -> Bool { drainedRequests.contains(requestId) }
}

private actor CountingLlamaEngine: ApexBridge.LlamaEngine {
    private var nonReadinessGenerationCalls = 0

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        if request.prompt.contains("readiness probe") {
            return AsyncThrowingStream { continuation in
                continuation.yield(Token(text: "ready", isComplete: true))
                continuation.finish()
            }
        }
        nonReadinessGenerationCalls += 1
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: "unexpected inference", isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
    func nonReadinessGenerationCount() -> Int { nonReadinessGenerationCalls }
}

private actor BlockingDrainLlamaEngine: ApexBridge.LlamaEngine {
    private var generationStarted = false
    private var generationStartedContinuation: CheckedContinuation<Void, Never>?
    private var drainStartedContinuation: CheckedContinuation<Void, Never>?
    private var drainContinuation: CheckedContinuation<Void, Never>?

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        if request.prompt.contains("readiness probe") {
            return AsyncThrowingStream { continuation in
                continuation.yield(Token(text: "ready", isComplete: true))
                continuation.finish()
            }
        }
        generationStarted = true
        generationStartedContinuation?.resume()
        generationStartedContinuation = nil
        return AsyncThrowingStream { continuation in
            let producer = Task {
                do {
                    try await Task.sleep(nanoseconds: 30_000_000_000)
                    continuation.yield(Token(text: "late", isComplete: true))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in producer.cancel() }
        }
    }

    func cancel(sessionId: String, requestId: String) async {}

    func cancelAndWait(sessionId: String, requestId: String) async {
        await withCheckedContinuation { continuation in
            drainContinuation = continuation
            drainStartedContinuation?.resume()
            drainStartedContinuation = nil
        }
    }

    func unload(sessionId: String) async {}

    func waitUntilGenerationStarted() async {
        if generationStarted { return }
        await withCheckedContinuation { continuation in
            generationStartedContinuation = continuation
        }
    }

    func waitUntilDrainStarted() async {
        if drainContinuation != nil { return }
        await withCheckedContinuation { continuation in
            drainStartedContinuation = continuation
        }
    }

    func finishDrain() {
        drainContinuation?.resume()
        drainContinuation = nil
    }
}

private actor PausingChallengeStore: BridgeChallengeConsuming {
    private var consumeContinuation: CheckedContinuation<Bool, Never>?
    private var startedContinuation: CheckedContinuation<Void, Never>?

    func consume(
        _ nonce: String,
        page: URL,
        trusted: URL,
        requestId: String,
        sessionId: String
    ) async -> Bool {
        await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                consumeContinuation = continuation
                startedContinuation?.resume()
                startedContinuation = nil
            }
        } onCancel: {
            // Cancellation of the request task releases this deterministic test
            // gate just as a real challenge store would eventually settle its IO.
            Task { await self.resumeConsume(true) }
        }
    }

    func waitUntilConsumeStarted() async {
        if consumeContinuation != nil { return }
        await withCheckedContinuation { continuation in
            startedContinuation = continuation
        }
    }

    func resumeConsume(_ accepted: Bool) {
        consumeContinuation?.resume(returning: accepted)
        consumeContinuation = nil
    }
}

private actor BlockingReadinessDrainEngine: ApexBridge.LlamaEngine {
    private var readinessStreamContinuation: AsyncThrowingStream<Token, Error>.Continuation?
    private var drainContinuation: CheckedContinuation<Void, Never>?
    private var readinessStarted = false
    private var drainStarted = false
    private var readinessWaiter: CheckedContinuation<Void, Never>?
    private var drainWaiter: CheckedContinuation<Void, Never>?

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        guard request.prompt.contains("readiness probe") else {
            return AsyncThrowingStream { continuation in
                continuation.finish(throwing: CancellationError())
            }
        }
        return AsyncThrowingStream { continuation in
            Task { await self.registerReadinessContinuation(continuation) }
        }
    }

    func cancel(sessionId: String, requestId: String) async {}

    func cancelAndWait(sessionId: String, requestId: String) async {
        drainStarted = true
        drainWaiter?.resume()
        drainWaiter = nil
        await withCheckedContinuation { drainContinuation = $0 }
    }

    func unload(sessionId: String) async {}

    private func registerReadinessContinuation(
        _ continuation: AsyncThrowingStream<Token, Error>.Continuation
    ) {
        readinessStreamContinuation = continuation
        readinessStarted = true
        readinessWaiter?.resume()
        readinessWaiter = nil
    }

    func waitUntilReadinessInferenceStarted() async {
        if readinessStarted { return }
        await withCheckedContinuation { readinessWaiter = $0 }
    }

    func waitUntilCancellationDrainStarted() async {
        if drainStarted { return }
        await withCheckedContinuation { drainWaiter = $0 }
    }

    func finishCancellationDrain() {
        drainContinuation?.resume()
        drainContinuation = nil
    }
}

private actor CancellationCompletionSignal {
    private var finished = false
    func markFinished() { finished = true }
    func hasFinished() -> Bool { finished }
}

private actor PausingFileHasher {
    private var continuation: CheckedContinuation<String, Error>?
    private var startedContinuation: CheckedContinuation<Void, Never>?

    func hash() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            startedContinuation?.resume()
            startedContinuation = nil
        }
    }

    func waitUntilStarted() async {
        if continuation != nil { return }
        await withCheckedContinuation { continuation in
            startedContinuation = continuation
        }
    }

    func resume(with hash: String) {
        continuation?.resume(returning: hash)
        continuation = nil
    }
}

private actor ThirdCallPausingFileHasher {
    private let expectedHash: String
    private var callCount = 0
    private var continuation: CheckedContinuation<String, Error>?
    private var startedContinuation: CheckedContinuation<Void, Never>?
    private var cancellationObserved = false
    private var cancellationWaiter: CheckedContinuation<Void, Never>?

    init(expectedHash: String) {
        self.expectedHash = expectedHash
    }

    func hash() async throws -> String {
        callCount += 1
        guard callCount == 3 else { return expectedHash }
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                startedContinuation?.resume()
                startedContinuation = nil
            }
        } onCancel: {
            Task { await self.cancelThirdCall() }
        }
    }

    func waitUntilThirdCallStarted() async {
        if callCount >= 3, continuation != nil { return }
        await withCheckedContinuation { continuation in
            startedContinuation = continuation
        }
    }

    func waitUntilThirdCallCancelled() async {
        if cancellationObserved { return }
        await withCheckedContinuation { cancellationWaiter = $0 }
    }

    private func cancelThirdCall() {
        cancellationObserved = true
        cancellationWaiter?.resume()
        cancellationWaiter = nil
        continuation?.resume(throwing: CancellationError())
        continuation = nil
    }

    func resume() {
        continuation?.resume(returning: expectedHash)
        continuation = nil
    }
}

final class RuntimeControllerTests: XCTestCase {
    private let trustedWorkspaceURL = URL(string: "https://workspace.example.test/app")!

    private func makeFixture(clock: TestClock, readinessTTL: TimeInterval = 120) throws -> (RuntimeController, NativeInferenceRuntime, URL, ModelDescriptor, String, BridgeChallengeStore) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modelURL = directory.appendingPathComponent("model.gguf")
        try Data("GGUF-model-fixture".utf8).write(to: modelURL)
        let descriptor = ModelDescriptor(
            id: "local-model-1",
            name: "Test model",
            path: modelURL.path,
            contextLength: 1024,
            quantization: "Q4_K_M"
        )
        let runtime = try NativeInferenceRuntime(
            engine: StubLlamaEngine(),
            poolConfiguration: try ModelPoolConfiguration(maxResidentMemoryMB: 4096, maxLoadedModels: 1),
            availableMemoryMB: { 4096 }
        )
        let challengeStore = try BridgeChallengeStore(clock: { clock.now() })
        let controller = try RuntimeController(
            runtime: runtime,
            deviceId: "test-device",
            runtimeIdentity: "test-runtime",
            challengeStore: challengeStore,
            trustedWorkspaceURL: trustedWorkspaceURL,
            readinessTTL: readinessTTL,
            clock: { clock.now() }
        )
        return (controller, runtime, modelURL, descriptor, Self.sha256(modelURL), challengeStore)
    }

    private func makePausedHasherFixture(
        _ hasher: PausingFileHasher
    ) async throws -> (RuntimeController, NativeInferenceRuntime, URL, ModelDescriptor, String) {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modelURL = directory.appendingPathComponent("model.gguf")
        try Data("GGUF-paused-hash-fixture".utf8).write(to: modelURL)
        let descriptor = ModelDescriptor(
            id: "paused-hash-model",
            name: "Paused hash model",
            path: modelURL.path,
            contextLength: 1024
        )
        let runtime = try NativeInferenceRuntime(
            engine: StubLlamaEngine(),
            poolConfiguration: try ModelPoolConfiguration(maxResidentMemoryMB: 4096, maxLoadedModels: 1),
            availableMemoryMB: { 4096 }
        )
        let challengeStore = try BridgeChallengeStore()
        let controller = try RuntimeController(
            runtime: runtime,
            deviceId: "test-device",
            runtimeIdentity: "test-runtime",
            challengeStore: challengeStore,
            trustedWorkspaceURL: trustedWorkspaceURL,
            fileHasher: { _ in try await hasher.hash() }
        )
        return (controller, runtime, modelURL, descriptor, Self.sha256(modelURL))
    }

    private static func sha256(_ url: URL) -> String {
        let data = (try? Data(contentsOf: url)) ?? Data()
        return SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    func testLoadRequiresRealReadinessBeforeGenerationAndReturnsUnsignedCandidate() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 1_000))
        let (controller, runtime, modelURL, descriptor, expectedHash, challengeStore) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }

        let loaded = try await controller.load(model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256)
        XCTAssertEqual(loaded.phase, "loaded")
        XCTAssertFalse(loaded.canGenerate)
        do {
            _ = try await controller.generate(
                sessionId: loaded.sessionId!, prompt: "hello", requestId: UUID().uuidString,
                conversationRequestId: "conversation-1", attemptId: "attempt-1",
                challengeNonce: "0123456789abcdef", pageURL: trustedWorkspaceURL
            )
            XCTFail("Generation must require a fresh readiness probe.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .notReady)
        }

        let ready = try await controller.readiness(sessionId: loaded.sessionId!)
        XCTAssertTrue(ready.canGenerate)
        XCTAssertNotNil(ready.healthCheckId)
        let requestId = UUID().uuidString
        let challenge = try await challengeStore.issue(
            page: trustedWorkspaceURL, trusted: trustedWorkspaceURL,
            requestId: requestId, sessionId: loaded.sessionId!
        )
        let record = try await controller.generate(
            sessionId: loaded.sessionId!, prompt: "hello", requestId: requestId,
            conversationRequestId: "conversation-1", attemptId: "attempt-1",
            challengeNonce: challenge, pageURL: trustedWorkspaceURL
        )
        XCTAssertEqual(record.output, "answer")
        XCTAssertEqual(record.requestId, requestId)
        XCTAssertEqual(record.modelId, descriptor.id)
        XCTAssertEqual(record.modelFileHash, ready.fileHash)
        XCTAssertEqual(record.healthCheckId, ready.healthCheckId)
        XCTAssertEqual(record.challengeNonce, challenge)
        XCTAssertFalse(record.authorized)
        XCTAssertFalse(String(describing: record).contains("signature"))
        let unloaded = await controller.unload(sessionId: loaded.sessionId!)
        let remainingReports = await controller.reports()
        let runtimeSnapshot = await runtime.snapshot()
        XCTAssertTrue(unloaded)
        XCTAssertTrue(remainingReports.isEmpty)
        XCTAssertTrue(runtimeSnapshot.loadedModelIDs.isEmpty)
    }

    func testCatalogHashMismatchFailsBeforeAcquiringLease() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 1_500))
        let (controller, runtime, modelURL, descriptor, expectedHash, _) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let wrongHash = String(repeating: "0", count: 64)
        XCTAssertNotEqual(expectedHash, wrongHash)
        do {
            _ = try await controller.load(model: descriptor, expectedFileHash: wrongHash, estimatedMemoryMB: 256)
            XCTFail("A catalog hash mismatch must fail closed.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .modelHashMismatch)
        }
        let reports = await controller.reports()
        let snapshot = await runtime.snapshot()
        XCTAssertTrue(reports.isEmpty)
        XCTAssertTrue(snapshot.loadedModelIDs.isEmpty)
    }

    func testDuplicateRuntimeSessionCannotOverwriteExistingLease() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 1_750))
        let (controller, runtime, modelURL, descriptor, expectedHash, _) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }

        let first = try await controller.load(
            model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256
        )
        do {
            _ = try await controller.load(
                model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256
            )
            XCTFail("A second bridge record must not overwrite the first lease for the same runtime session.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .duplicateSession)
        }

        let reports = await controller.reports()
        let snapshot = await runtime.snapshot()
        XCTAssertEqual(reports.count, 1)
        XCTAssertEqual(reports.first?.sessionId, first.sessionId)
        XCTAssertEqual(snapshot.activeLeaseCount, 1)

        let didUnload = await controller.unload(sessionId: first.sessionId!)
        XCTAssertTrue(didUnload)
        let afterUnload = await runtime.snapshot()
        XCTAssertTrue(afterUnload.loadedModelIDs.isEmpty)
    }


    func testGenerationRejectsFabricatedAndReplayedChallenges() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 1_500))
        let (controller, _, modelURL, descriptor, expectedHash, challengeStore) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256)
        _ = try await controller.readiness(sessionId: loaded.sessionId!)

        let fabricatedRequest = UUID().uuidString
        do {
            _ = try await controller.generate(
                sessionId: loaded.sessionId!, prompt: "must not run", requestId: fabricatedRequest,
                conversationRequestId: "conversation-1", attemptId: "attempt-fake",
                challengeNonce: "0123456789abcdef0123456789abcdef", pageURL: trustedWorkspaceURL
            )
            XCTFail("A caller-supplied nonce must not authorize generation.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .unauthorizedChallenge)
        }

        let requestId = UUID().uuidString
        let challenge = try await challengeStore.issue(
            page: trustedWorkspaceURL, trusted: trustedWorkspaceURL,
            requestId: requestId, sessionId: loaded.sessionId!
        )
        _ = try await controller.generate(
            sessionId: loaded.sessionId!, prompt: "authorized once", requestId: requestId,
            conversationRequestId: "conversation-1", attemptId: "attempt-valid",
            challengeNonce: challenge, pageURL: trustedWorkspaceURL
        )

        do {
            _ = try await controller.generate(
                sessionId: loaded.sessionId!, prompt: "replay", requestId: UUID().uuidString,
                conversationRequestId: "conversation-1", attemptId: "attempt-replay",
                challengeNonce: challenge, pageURL: trustedWorkspaceURL
            )
            XCTFail("A consumed challenge must not authorize a second generation.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .unauthorizedChallenge)
        }
    }

    func testReadinessExpiresAndCannotBeReused() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 2_000))
        let (controller, _, modelURL, descriptor, expectedHash, _) = try makeFixture(clock: clock, readinessTTL: 30)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256)
        _ = try await controller.readiness(sessionId: loaded.sessionId!)
        clock.advance(31)
        do {
            _ = try await controller.generate(
                sessionId: loaded.sessionId!, prompt: "hello", requestId: UUID().uuidString,
                conversationRequestId: "conversation-1", attemptId: "attempt-1",
                challengeNonce: "0123456789abcdef", pageURL: trustedWorkspaceURL
            )
            XCTFail("Expired readiness must fail closed.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .notReady)
        }
    }

    func testModelFileChangeInvalidatesReadinessAndGeneration() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 3_000))
        let (controller, _, modelURL, descriptor, expectedHash, _) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256)
        _ = try await controller.readiness(sessionId: loaded.sessionId!)
        try Data("GGUF-replaced-with-different-size".utf8).write(to: modelURL, options: .atomic)
        do {
            _ = try await controller.generate(
                sessionId: loaded.sessionId!, prompt: "hello", requestId: UUID().uuidString,
                conversationRequestId: "conversation-1", attemptId: "attempt-1",
                challengeNonce: "0123456789abcdef", pageURL: trustedWorkspaceURL
            )
            XCTFail("A changed model artifact must invalidate the active session.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .modelFileChanged)
        }
        let reports = await controller.reports()
        XCTAssertFalse(reports.first?.canGenerate ?? true)
    }


    func testSameSizeModelMutationWithRestoredTimestampInvalidatesReadiness() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 3_250))
        let (controller, _, modelURL, descriptor, expectedHash, _) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }

        let loaded = try await controller.load(model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256)
        _ = try await controller.readiness(sessionId: loaded.sessionId!)
        let originalAttributes = try FileManager.default.attributesOfItem(atPath: modelURL.path)
        let originalDate = try XCTUnwrap(originalAttributes[.modificationDate] as? Date)
        let originalSize = (originalAttributes[.size] as? NSNumber)?.intValue
        try Data("GGUF-MODEL-FIXTURE".utf8).write(to: modelURL, options: .atomic)
        try FileManager.default.setAttributes([.modificationDate: originalDate], ofItemAtPath: modelURL.path)
        let changedAttributes = try FileManager.default.attributesOfItem(atPath: modelURL.path)
        XCTAssertEqual((changedAttributes[.size] as? NSNumber)?.intValue, originalSize)
        let changedDate = try XCTUnwrap(changedAttributes[.modificationDate] as? Date)
        // APFS/HFS timestamp precision can differ slightly after atomic replacement.
        // Verify restoration within filesystem precision; the SHA-256 assertion below
        // proves that the artifact bytes nevertheless changed.
        XCTAssertLessThanOrEqual(abs(changedDate.timeIntervalSince(originalDate)), 1.0)
        XCTAssertNotEqual(Self.sha256(modelURL), expectedHash)

        do {
            _ = try await controller.readiness(sessionId: loaded.sessionId!)
            XCTFail("A same-size byte mutation must invalidate the loaded artifact even if its timestamp is restored.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .modelFileChanged)
        }
        let reports = await controller.reports()
        XCTAssertFalse(reports.first?.canGenerate ?? true)
    }

    func testCancelGenerationWaitsForNativeDrain() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 5_000))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modelURL = directory.appendingPathComponent("model.gguf")
        try Data("GGUF-slow-fixture".utf8).write(to: modelURL)
        defer { try? FileManager.default.removeItem(at: directory) }
        let descriptor = ModelDescriptor(id: "slow-model", name: "Slow model", path: modelURL.path, contextLength: 1024)
        let expectedHash = Self.sha256(modelURL)
        let engine = SlowLlamaEngine()
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(maxResidentMemoryMB: 4096, maxLoadedModels: 1),
            availableMemoryMB: { 4096 }
        )
        let challengeStore = try BridgeChallengeStore(clock: { clock.now() })
        let controller = try RuntimeController(runtime: runtime, deviceId: "test-device", runtimeIdentity: "test-runtime", challengeStore: challengeStore, trustedWorkspaceURL: trustedWorkspaceURL, clock: { clock.now() })
        let loaded = try await controller.load(model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256)
        _ = try await controller.readiness(sessionId: loaded.sessionId!)
        let requestId = UUID().uuidString
        let challenge = try await challengeStore.issue(page: trustedWorkspaceURL, trusted: trustedWorkspaceURL, requestId: requestId, sessionId: loaded.sessionId!)
        let generation = Task {
            try await controller.generate(
                sessionId: loaded.sessionId!, prompt: "slow request", requestId: requestId,
                conversationRequestId: "conversation-2", attemptId: "attempt-2",
                challengeNonce: challenge, pageURL: trustedWorkspaceURL
            )
        }
        try await Task.sleep(nanoseconds: 100_000_000)
        let cancelledCount = await controller.cancelAllGenerations()
        XCTAssertEqual(cancelledCount, 1)
        do {
            _ = try await generation.value
            XCTFail("Cancelled generation must not return output.")
        } catch {}
        let drained = await engine.wasDrained(requestId)
        XCTAssertTrue(drained)
        _ = await controller.unload(sessionId: loaded.sessionId!)
    }

    func testDisconnectRetainsLeaseUntilNativeCancellationDrainCompletes() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 6_000))
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modelURL = directory.appendingPathComponent("model.gguf")
        try Data("GGUF-blocked-drain-fixture".utf8).write(to: modelURL)
        defer { try? FileManager.default.removeItem(at: directory) }
        let descriptor = ModelDescriptor(id: "blocked-drain-model", name: "Blocked drain model", path: modelURL.path, contextLength: 1024)
        let engine = BlockingDrainLlamaEngine()
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(maxResidentMemoryMB: 4096, maxLoadedModels: 1),
            availableMemoryMB: { 4096 }
        )
        let challengeStore = try BridgeChallengeStore(clock: { clock.now() })
        let controller = try RuntimeController(
            runtime: runtime,
            deviceId: "test-device",
            runtimeIdentity: "test-runtime",
            challengeStore: challengeStore,
            trustedWorkspaceURL: trustedWorkspaceURL,
            clock: { clock.now() }
        )
        let loaded = try await controller.load(
            model: descriptor,
            expectedFileHash: Self.sha256(modelURL),
            estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)
        _ = try await controller.readiness(sessionId: sessionID)

        let requestId = UUID().uuidString
        let challenge = try await challengeStore.issue(
            page: trustedWorkspaceURL,
            trusted: trustedWorkspaceURL,
            requestId: requestId,
            sessionId: sessionID
        )
        let generation = Task {
            try await controller.generate(
                sessionId: sessionID,
                prompt: "hold until disconnect drains",
                requestId: requestId,
                conversationRequestId: "disconnect-drain",
                attemptId: "disconnect-drain-attempt",
                challengeNonce: challenge,
                pageURL: trustedWorkspaceURL
            )
        }
        await engine.waitUntilGenerationStarted()

        let disconnect = Task { await controller.disconnect() }
        await engine.waitUntilDrainStarted()

        let whileDraining = await runtime.snapshot()
        XCTAssertEqual(whileDraining.activeLeaseCount, 1, "The controller lease must remain held while native cancellation is draining.")
        XCTAssertEqual(whileDraining.activeUseCount, 1, "The inference use-pin must remain held until cancelAndWait returns.")
        XCTAssertEqual(whileDraining.loadedModelIDs, [descriptor.id])

        await engine.finishDrain()
        await disconnect.value
        do {
            _ = try await generation.value
            XCTFail("Disconnect must not return a generation result.")
        } catch {
            // Cancellation is expected after native drain completes.
        }

        let afterDrain = await runtime.snapshot()
        XCTAssertEqual(afterDrain.activeLeaseCount, 0)
        XCTAssertEqual(afterDrain.activeUseCount, 0)
        XCTAssertTrue(afterDrain.loadedModelIDs.isEmpty)
    }

    func testCancelAllInvalidatesGenerationSuspendedDuringChallengeConsumption() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modelURL = directory.appendingPathComponent("model.gguf")
        try Data("GGUF-navigation-cancel-race-fixture".utf8).write(to: modelURL)
        defer { try? FileManager.default.removeItem(at: directory) }

        let descriptor = ModelDescriptor(
            id: "navigation-cancel-race-model",
            name: "Navigation cancel race model",
            path: modelURL.path,
            contextLength: 1024
        )
        let engine = CountingLlamaEngine()
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(maxResidentMemoryMB: 4096, maxLoadedModels: 1),
            availableMemoryMB: { 4096 }
        )
        let challengeStore = PausingChallengeStore()
        let controller = try RuntimeController(
            runtime: runtime,
            deviceId: "test-device",
            runtimeIdentity: "test-runtime",
            challengeStore: challengeStore,
            trustedWorkspaceURL: trustedWorkspaceURL
        )
        let loaded = try await controller.load(
            model: descriptor,
            expectedFileHash: Self.sha256(modelURL),
            estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)
        _ = try await controller.readiness(sessionId: sessionID)

        let requestID = UUID().uuidString
        let generation = Task {
            try await controller.generate(
                sessionId: sessionID,
                prompt: "This must not start after navigation cancellation.",
                requestId: requestID,
                conversationRequestId: "navigation-cancel-race",
                attemptId: "navigation-cancel-race-attempt",
                challengeNonce: String(repeating: "b", count: 32),
                pageURL: trustedWorkspaceURL
            )
        }
        await challengeStore.waitUntilConsumeStarted()

        let cancellation = Task { await controller.cancelAllGenerations() }
        let cancelledCount = await cancellation.value
        XCTAssertEqual(cancelledCount, 1, "Navigation cancellation must find and drain a request still consuming its challenge.")

        do {
            _ = try await generation.value
            XCTFail("A generation suspended during challenge consumption must be invalidated by cancelAllGenerations.")
        } catch is CancellationError {
            // Expected: the lifecycle epoch changed while challenge consumption was suspended.
        } catch {
            XCTFail("Expected CancellationError, received: \(error)")
        }

        let inferenceCalls = await engine.nonReadinessGenerationCount()
        XCTAssertEqual(inferenceCalls, 0, "No native inference call may begin after the navigation drain.")
        let snapshot = await runtime.snapshot()
        XCTAssertEqual(snapshot.activeLeaseCount, 1, "Navigation cancellation must preserve the controller's loaded session lease.")
        XCTAssertEqual(snapshot.activeUseCount, 0)
        await controller.disconnect()
    }

    func testCancelAllInvalidatesGenerationSuspendedDuringPostChallengeFileHash() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modelURL = directory.appendingPathComponent("model.gguf")
        try Data("GGUF-post-challenge-hash-race-fixture".utf8).write(to: modelURL)
        defer { try? FileManager.default.removeItem(at: directory) }

        let expectedHash = Self.sha256(modelURL)
        let hasher = ThirdCallPausingFileHasher(expectedHash: expectedHash)
        let descriptor = ModelDescriptor(
            id: "post-challenge-hash-race-model",
            name: "Post challenge hash race model",
            path: modelURL.path,
            contextLength: 1024
        )
        let engine = CountingLlamaEngine()
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(maxResidentMemoryMB: 4096, maxLoadedModels: 1),
            availableMemoryMB: { 4096 }
        )
        let challengeStore = try BridgeChallengeStore()
        let controller = try RuntimeController(
            runtime: runtime,
            deviceId: "test-device",
            runtimeIdentity: "test-runtime",
            challengeStore: challengeStore,
            trustedWorkspaceURL: trustedWorkspaceURL,
            fileHasher: { _ in try await hasher.hash() }
        )
        let loaded = try await controller.load(
            model: descriptor,
            expectedFileHash: expectedHash,
            estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)
        _ = try await controller.readiness(sessionId: sessionID)

        let requestID = UUID().uuidString
        let nonce = try await challengeStore.issue(
            page: trustedWorkspaceURL,
            trusted: trustedWorkspaceURL,
            requestId: requestID,
            sessionId: sessionID
        )
        let generation = Task {
            try await controller.generate(
                sessionId: sessionID,
                prompt: "This must not start after navigation during the post-challenge hash.",
                requestId: requestID,
                conversationRequestId: "post-challenge-hash-navigation",
                attemptId: "post-challenge-hash-navigation-attempt",
                challengeNonce: nonce,
                pageURL: trustedWorkspaceURL
            )
        }

        // Hash calls one and two cover readiness and pre-challenge verification.
        // The third call is the post-consumption re-hash; reaching this gate proves
        // the real one-use challenge has already been accepted.
        await hasher.waitUntilThirdCallStarted()

        let cancellation = Task { await controller.cancelAllGenerations() }
        // The request is now registered before preparation. cancelAll must wait
        // for this suspended hash to settle rather than returning early.
        await hasher.waitUntilThirdCallCancelled()
        let cancelledCount = await cancellation.value
        XCTAssertEqual(cancelledCount, 1, "Navigation cancellation must drain a request suspended in the post-challenge hash.")

        do {
            _ = try await generation.value
            XCTFail("A generation suspended in the post-challenge hash must not start after navigation cancellation.")
        } catch is CancellationError {
            // Expected: cancelAllGenerations advanced the lifecycle epoch before the hash resumed.
        } catch {
            XCTFail("Expected CancellationError, received: \(error)")
        }

        let replayAccepted = await challengeStore.consume(
            nonce,
            page: trustedWorkspaceURL,
            trusted: trustedWorkspaceURL,
            requestId: requestID,
            sessionId: sessionID
        )
        XCTAssertFalse(replayAccepted, "The paused post-challenge hash is reached only after the one-use nonce was consumed.")

        let inferenceCalls = await engine.nonReadinessGenerationCount()
        XCTAssertEqual(inferenceCalls, 0, "No native inference call may begin after navigation cancellation.")
        let snapshot = await runtime.snapshot()
        XCTAssertEqual(snapshot.activeLeaseCount, 1, "Navigation cancellation must preserve the controller's loaded session lease.")
        XCTAssertEqual(snapshot.activeUseCount, 0)
        XCTAssertEqual(snapshot.loadedModelIDs, [descriptor.id])
        await controller.disconnect()
    }

    func testDisconnectDuringChallengeConsumptionPreventsInference() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modelURL = directory.appendingPathComponent("model.gguf")
        try Data("GGUF-disconnect-race-fixture".utf8).write(to: modelURL)
        defer { try? FileManager.default.removeItem(at: directory) }

        let descriptor = ModelDescriptor(
            id: "disconnect-race-model",
            name: "Disconnect race model",
            path: modelURL.path,
            contextLength: 1024
        )
        let runtime = try NativeInferenceRuntime(
            engine: StubLlamaEngine(),
            poolConfiguration: try ModelPoolConfiguration(maxResidentMemoryMB: 4096, maxLoadedModels: 1),
            availableMemoryMB: { 4096 }
        )
        let challengeStore = PausingChallengeStore()
        let controller = try RuntimeController(
            runtime: runtime,
            deviceId: "test-device",
            runtimeIdentity: "test-runtime",
            challengeStore: challengeStore,
            trustedWorkspaceURL: trustedWorkspaceURL
        )
        let expectedHash = Self.sha256(modelURL)
        let loaded = try await controller.load(
            model: descriptor,
            expectedFileHash: expectedHash,
            estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)
        _ = try await controller.readiness(sessionId: sessionID)

        let requestID = UUID().uuidString
        let generation = Task {
            try await controller.generate(
                sessionId: sessionID,
                prompt: "This must not reach inference after disconnect.",
                requestId: requestID,
                conversationRequestId: "disconnect-race",
                attemptId: "disconnect-race-attempt",
                challengeNonce: String(repeating: "a", count: 32),
                pageURL: trustedWorkspaceURL
            )
        }

        await challengeStore.waitUntilConsumeStarted()
        await controller.disconnect()
        await challengeStore.resumeConsume(true)

        do {
            _ = try await generation.value
            XCTFail("Generation must not start after its session has been disconnected.")
        } catch is CancellationError {
            // Unload cancels and drains the registered request before releasing its lease.
        } catch {
            XCTFail("Expected cancellation after unload, received: \(error)")
        }

        let reports = await controller.reports()
        let snapshot = await runtime.snapshot()
        XCTAssertTrue(reports.isEmpty)
        XCTAssertTrue(snapshot.loadedModelIDs.isEmpty)
    }

    func testModelFileMutationDuringChallengeConsumptionInvalidatesReadiness() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modelURL = directory.appendingPathComponent("model.gguf")
        try Data("GGUF-model-file-race-fixture".utf8).write(to: modelURL)
        defer { try? FileManager.default.removeItem(at: directory) }

        let descriptor = ModelDescriptor(
            id: "model-file-race-model",
            name: "Model file race model",
            path: modelURL.path,
            contextLength: 1024
        )
        let runtime = try NativeInferenceRuntime(
            engine: StubLlamaEngine(),
            poolConfiguration: try ModelPoolConfiguration(maxResidentMemoryMB: 4096, maxLoadedModels: 1),
            availableMemoryMB: { 4096 }
        )
        let challengeStore = PausingChallengeStore()
        let controller = try RuntimeController(
            runtime: runtime,
            deviceId: "test-device",
            runtimeIdentity: "test-runtime",
            challengeStore: challengeStore,
            trustedWorkspaceURL: trustedWorkspaceURL
        )
        let loaded = try await controller.load(
            model: descriptor,
            expectedFileHash: Self.sha256(modelURL),
            estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)
        _ = try await controller.readiness(sessionId: sessionID)

        let generation = Task {
            try await controller.generate(
                sessionId: sessionID,
                prompt: "A changed model file must not pass authorization.",
                requestId: UUID().uuidString,
                conversationRequestId: "model-file-race",
                attemptId: "model-file-race-attempt",
                challengeNonce: String(repeating: "c", count: 32),
                pageURL: trustedWorkspaceURL
            )
        }

        await challengeStore.waitUntilConsumeStarted()
        let originalAttributes = try FileManager.default.attributesOfItem(atPath: modelURL.path)
        let originalModifiedAt = try XCTUnwrap(originalAttributes[.modificationDate] as? Date)
        let handle = try FileHandle(forWritingTo: modelURL)
        try handle.seek(toOffset: 8)
        try handle.write(contentsOf: Data([0x58]))
        try handle.close()
        try FileManager.default.setAttributes(
            [.modificationDate: originalModifiedAt],
            ofItemAtPath: modelURL.path
        )
        await challengeStore.resumeConsume(true)

        do {
            _ = try await generation.value
            XCTFail("A same-size model rewrite with restored modification time must block inference.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .modelFileChanged)
        }

        let report = await controller.reports().first
        XCTAssertFalse(report?.canGenerate ?? true)
        await controller.disconnect()
    }

    func testCancellationDuringChallengeConsumptionDoesNotStartInference() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modelURL = directory.appendingPathComponent("model.gguf")
        try Data("GGUF-cancel-race-fixture".utf8).write(to: modelURL)
        defer { try? FileManager.default.removeItem(at: directory) }

        let descriptor = ModelDescriptor(
            id: "cancel-race-model",
            name: "Cancel race model",
            path: modelURL.path,
            contextLength: 1024
        )
        let runtime = try NativeInferenceRuntime(
            engine: StubLlamaEngine(),
            poolConfiguration: try ModelPoolConfiguration(maxResidentMemoryMB: 4096, maxLoadedModels: 1),
            availableMemoryMB: { 4096 }
        )
        let challengeStore = PausingChallengeStore()
        let controller = try RuntimeController(
            runtime: runtime,
            deviceId: "test-device",
            runtimeIdentity: "test-runtime",
            challengeStore: challengeStore,
            trustedWorkspaceURL: trustedWorkspaceURL
        )
        let loaded = try await controller.load(
            model: descriptor,
            expectedFileHash: Self.sha256(modelURL),
            estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)
        _ = try await controller.readiness(sessionId: sessionID)

        let requestID = UUID().uuidString
        let generation = Task {
            try await controller.generate(
                sessionId: sessionID,
                prompt: "This must not reach inference after cancellation.",
                requestId: requestID,
                conversationRequestId: "cancel-race",
                attemptId: "cancel-race-attempt",
                challengeNonce: String(repeating: "b", count: 32),
                pageURL: trustedWorkspaceURL
            )
        }
        await challengeStore.waitUntilConsumeStarted()
        let cancellation = Task {
            await controller.cancelGeneration(sessionId: sessionID, requestId: requestID)
        }
        // The challenge-store fixture resumes its suspended consume only after
        // the request task receives cancellation, making the drain assertion deterministic.
        let cancellationConfirmed = await cancellation.value
        XCTAssertTrue(cancellationConfirmed, "A preparation-stage request must be discoverable and drained by its exact request ID.")

        do {
            _ = try await generation.value
            XCTFail("A cancelled request must not start inference after challenge consumption.")
        } catch is CancellationError {
            // Expected: cancellation was observed before native inference began.
        } catch {
            XCTFail("Expected CancellationError, received: \(error)")
        }

        let report = await controller.reports().first
        XCTAssertEqual(report?.sessionId, sessionID)
        XCTAssertTrue(report?.canGenerate ?? false)
        await controller.disconnect()
    }

    func testLateCancellationDoesNotClaimCompletedGenerationWasCancelled() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 4_400))
        let (controller, _, modelURL, descriptor, expectedHash, challengeStore) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(
            model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)
        _ = try await controller.readiness(sessionId: sessionID)
        let requestID = UUID().uuidString
        let nonce = try await challengeStore.issue(
            page: trustedWorkspaceURL,
            trusted: trustedWorkspaceURL,
            requestId: requestID,
            sessionId: sessionID
        )

        let record = try await controller.generate(
            sessionId: sessionID,
            prompt: "Complete before cancellation arrives.",
            requestId: requestID,
            conversationRequestId: "late-cancel",
            attemptId: "late-cancel-attempt",
            challengeNonce: nonce,
            pageURL: trustedWorkspaceURL
        )
        XCTAssertEqual(record.output, "answer")

        let cancelled = await controller.cancelGeneration(sessionId: sessionID, requestId: requestID)
        XCTAssertFalse(cancelled, "A completed generation must not be reported as cancelled merely because its caller has not yet processed the result.")
        await controller.disconnect()
    }

    func testCancellationDeliveredBeforeGenerationBlocksExactRequest() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 4_500))
        let (controller, runtime, modelURL, descriptor, expectedHash, challengeStore) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(
            model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)
        _ = try await controller.readiness(sessionId: sessionID)

        let requestID = UUID().uuidString
        let cancellationConfirmed = await controller.cancelGeneration(
            sessionId: sessionID,
            requestId: requestID
        )
        XCTAssertTrue(cancellationConfirmed, "A valid exact-request cancellation may arrive before its generation message.")

        let nonce = try await challengeStore.issue(
            page: trustedWorkspaceURL,
            trusted: trustedWorkspaceURL,
            requestId: requestID,
            sessionId: sessionID
        )
        do {
            _ = try await controller.generate(
                sessionId: sessionID,
                prompt: "This exact request was cancelled before dispatch.",
                requestId: requestID,
                conversationRequestId: "cancel-before-generate",
                attemptId: "cancel-before-generate-attempt",
                challengeNonce: nonce,
                pageURL: trustedWorkspaceURL
            )
            XCTFail("A matching generation must not start after its cancellation tombstone was recorded.")
        } catch is CancellationError {
            // Expected: the one-use tombstone is consumed before preparation starts.
        } catch {
            XCTFail("Expected CancellationError, received: \(error)")
        }

        do {
            _ = try await controller.generate(
                sessionId: sessionID,
                prompt: "A replay must not revive the cancelled request identity.",
                requestId: requestID,
                conversationRequestId: "cancel-before-generate-replay",
                attemptId: "cancel-before-generate-replay-attempt",
                challengeNonce: nonce,
                pageURL: trustedWorkspaceURL
            )
            XCTFail("A request ID consumed by early cancellation must remain retired, even while its challenge is unused.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .duplicateRequest)
        }

        let report = await controller.reports().first
        XCTAssertEqual(report?.sessionId, sessionID)
        XCTAssertTrue(report?.canGenerate ?? false, "A rejected cancelled request must not invalidate the model's readiness.")
        let snapshot = await runtime.snapshot()
        XCTAssertEqual(snapshot.activeUseCount, 0)
        await controller.disconnect()
    }

    func testCancellationRegistryFailsClosedAtCapacity() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 5_000))
        let (controller, _, modelURL, descriptor, expectedHash, _) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(
            model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)
        _ = try await controller.readiness(sessionId: sessionID)

        for index in 0..<512 {
            let accepted = await controller.cancelGeneration(
                sessionId: sessionID,
                requestId: UUID().uuidString
            )
            XCTAssertTrue(accepted, "Cancellation identity \(index) should fit within the registry.")
        }
        let overflow = await controller.cancelGeneration(
            sessionId: sessionID,
            requestId: UUID().uuidString
        )
        XCTAssertFalse(overflow, "The controller must not acknowledge an unrecordable cancellation.")
        await controller.disconnect()
    }

    func testDisconnectReleasesSessionsAndIdleModels() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 4_000))
        let (controller, runtime, modelURL, descriptor, expectedHash, _) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        _ = try await controller.load(model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256)
        await controller.disconnect()
        let reports = await controller.reports()
        let snapshot = await runtime.snapshot()
        XCTAssertTrue(reports.isEmpty)
        XCTAssertTrue(snapshot.loadedModelIDs.isEmpty)
    }

    func testConcurrentReadinessReservesBeforeSuspendedFileHash() async throws {
        let hasher = PausingFileHasher()
        let (controller, _, modelURL, descriptor, expectedHash) = try await makePausedHasherFixture(hasher)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(
            model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)

        let firstReadiness = Task { try await controller.readiness(sessionId: sessionID) }
        await hasher.waitUntilStarted()

        do {
            _ = try await controller.readiness(sessionId: sessionID)
            XCTFail("A second readiness request must not pass the reserved attempt.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .duplicateRequest)
        }

        await hasher.resume(with: expectedHash)
        let ready = try await firstReadiness.value
        XCTAssertTrue(ready.canGenerate)
        await controller.disconnect()
    }

    func testCancelAllInvalidatesReadinessSuspendedDuringFileHash() async throws {
        let hasher = PausingFileHasher()
        let (controller, runtime, modelURL, descriptor, expectedHash) = try await makePausedHasherFixture(hasher)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(
            model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)

        let readiness = Task { try await controller.readiness(sessionId: sessionID) }
        await hasher.waitUntilStarted()

        // No native readiness task exists yet: cancellation must invalidate the
        // suspended hash attempt so it cannot register one after navigation.
        let cancelled = await controller.cancelAllGenerations()
        XCTAssertEqual(cancelled, 0)
        await hasher.resume(with: expectedHash)

        do {
            _ = try await readiness.value
            XCTFail("A readiness attempt suspended during file verification must not start after navigation cancellation.")
        } catch is CancellationError {
            // Expected: the shared runtime lifecycle epoch changed during hashing.
        } catch {
            XCTFail("Expected CancellationError, received: \(error)")
        }

        let report = await controller.reports().first
        XCTAssertFalse(report?.canGenerate ?? true)
        let snapshot = await runtime.snapshot()
        XCTAssertEqual(snapshot.activeLeaseCount, 1, "Navigation cancellation preserves the controller lease.")
        XCTAssertEqual(snapshot.activeUseCount, 0, "No native readiness inference may start after cancellation.")
        await controller.disconnect()
    }

    func testCancelAllWaitsForRegisteredReadinessNativeDrain() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let modelURL = directory.appendingPathComponent("readiness-drain.gguf")
        try Data("GGUF-readiness-drain-fixture".utf8).write(to: modelURL)
        defer { try? FileManager.default.removeItem(at: directory) }

        let descriptor = ModelDescriptor(
            id: "readiness-drain-model",
            name: "Readiness drain model",
            path: modelURL.path,
            contextLength: 1024
        )
        let engine = BlockingReadinessDrainEngine()
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(maxResidentMemoryMB: 4096, maxLoadedModels: 1),
            availableMemoryMB: { 4096 }
        )
        let challengeStore = try BridgeChallengeStore()
        let controller = try RuntimeController(
            runtime: runtime,
            deviceId: "test-device",
            runtimeIdentity: "test-runtime",
            challengeStore: challengeStore,
            trustedWorkspaceURL: trustedWorkspaceURL
        )
        let expectedHash = Self.sha256(modelURL)
        let loaded = try await controller.load(
            model: descriptor,
            expectedFileHash: expectedHash,
            estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)

        let readiness = Task { try await controller.readiness(sessionId: sessionID) }
        await engine.waitUntilReadinessInferenceStarted()

        let cancellationFinished = CancellationCompletionSignal()
        let cancellation = Task {
            _ = await controller.cancelAllGenerations()
            await cancellationFinished.markFinished()
        }
        await engine.waitUntilCancellationDrainStarted()

        let whileDraining = await runtime.snapshot()
        XCTAssertEqual(whileDraining.activeLeaseCount, 1)
        XCTAssertEqual(whileDraining.activeUseCount, 1, "The readiness inference use-pin must remain held during native drain.")
        let finishedBeforeDrain = await cancellationFinished.hasFinished()
        XCTAssertFalse(finishedBeforeDrain, "cancelAllGenerations must not return before the native readiness drain.")

        await engine.finishCancellationDrain()
        await cancellation.value
        do {
            _ = try await readiness.value
            XCTFail("A readiness probe cancelled during native inference must not succeed.")
        } catch is CancellationError {
            // Expected: readiness is cancelled and its native drain has completed.
        } catch {
            XCTFail("Expected CancellationError, received: \\(error)")
        }

        let afterDrain = await runtime.snapshot()
        XCTAssertEqual(afterDrain.activeLeaseCount, 1, "Navigation cancellation preserves the loaded controller lease.")
        XCTAssertEqual(afterDrain.activeUseCount, 0, "The readiness use-pin is released only after native drain.")
        let readinessReport = await controller.reports().first
        XCTAssertFalse(readinessReport?.canGenerate ?? true)
        await controller.disconnect()
    }

    func testUnloadDuringReadinessHashPreventsStaleProbe() async throws {
        let hasher = PausingFileHasher()
        let (controller, runtime, modelURL, descriptor, expectedHash) = try await makePausedHasherFixture(hasher)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(
            model: descriptor, expectedFileHash: expectedHash, estimatedMemoryMB: 256
        )
        let sessionID = try XCTUnwrap(loaded.sessionId)

        let readiness = Task { try await controller.readiness(sessionId: sessionID) }
        await hasher.waitUntilStarted()

        let didUnload = await controller.unload(sessionId: sessionID)
        XCTAssertTrue(didUnload)
        await hasher.resume(with: expectedHash)

        do {
            _ = try await readiness.value
            XCTFail("A stale readiness caller must not start a probe after unload.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .unknownSession)
        }
        let reports = await controller.reports()
        let snapshot = await runtime.snapshot()
        XCTAssertTrue(reports.isEmpty)
        XCTAssertTrue(snapshot.loadedModelIDs.isEmpty)
    }

}


final class BridgeChallengeStoreTests: XCTestCase {
    func testChallengeIsBoundToOriginRequestAndSessionAndConsumedOnce() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 10_000))
        let store = try BridgeChallengeStore(lifetime: 60, clock: { clock.now() })
        let trusted = URL(string: "https://workspace.example.test/app")!
        let requestId = UUID().uuidString
        let sessionId = UUID().uuidString
        let nonce = try await store.issue(
            page: trusted, trusted: trusted, requestId: requestId, sessionId: sessionId
        )

        XCTAssertEqual(nonce.utf8.count, 64)
        let firstConsume = await store.consume(
            nonce, page: trusted, trusted: trusted, requestId: requestId, sessionId: sessionId
        )
        let replayConsume = await store.consume(
            nonce, page: trusted, trusted: trusted, requestId: requestId, sessionId: sessionId
        )
        XCTAssertTrue(firstConsume)
        XCTAssertFalse(replayConsume)
    }

    func testWrongBindingAndOriginCannotConsumeChallenge() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 11_000))
        let store = try BridgeChallengeStore(clock: { clock.now() })
        let trusted = URL(string: "https://workspace.example.test")!
        let foreign = URL(string: "https://attacker.example.test")!
        let requestId = UUID().uuidString
        let sessionId = UUID().uuidString
        let nonce = try await store.issue(
            page: trusted, trusted: trusted, requestId: requestId, sessionId: sessionId
        )

        let foreignConsume = await store.consume(
            nonce, page: foreign, trusted: trusted, requestId: requestId, sessionId: sessionId
        )
        let wrongRequestConsume = await store.consume(
            nonce, page: trusted, trusted: trusted, requestId: UUID().uuidString, sessionId: sessionId
        )
        let wrongSessionConsume = await store.consume(
            nonce, page: trusted, trusted: trusted, requestId: requestId, sessionId: UUID().uuidString
        )
        let validConsume = await store.consume(
            nonce, page: trusted, trusted: trusted, requestId: requestId, sessionId: sessionId
        )
        XCTAssertFalse(foreignConsume)
        XCTAssertFalse(wrongRequestConsume)
        XCTAssertFalse(wrongSessionConsume)
        XCTAssertTrue(validConsume)
    }

    func testExpiredChallengeFailsClosed() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 12_000))
        let store = try BridgeChallengeStore(lifetime: 5, clock: { clock.now() })
        let trusted = URL(string: "https://workspace.example.test")!
        let requestId = UUID().uuidString
        let sessionId = UUID().uuidString
        let nonce = try await store.issue(
            page: trusted, trusted: trusted,
            requestId: requestId, sessionId: sessionId
        )
        clock.advance(6)
        let consumed = await store.consume(
            nonce, page: trusted, trusted: trusted,
            requestId: requestId, sessionId: sessionId
        )
        XCTAssertFalse(consumed)
    }

    func testInvalidateAllRevokesOutstandingChallenges() async throws {
        let store = try BridgeChallengeStore()
        let trusted = URL(string: "https://workspace.example.test")!
        let firstRequest = UUID().uuidString
        let secondRequest = UUID().uuidString
        let sessionId = UUID().uuidString
        let firstNonce = try await store.issue(
            page: trusted, trusted: trusted,
            requestId: firstRequest, sessionId: sessionId
        )
        let secondNonce = try await store.issue(
            page: trusted, trusted: trusted,
            requestId: secondRequest, sessionId: sessionId
        )

        await store.invalidateAll()

        let firstConsumed = await store.consume(
            firstNonce, page: trusted, trusted: trusted,
            requestId: firstRequest, sessionId: sessionId
        )
        let secondConsumed = await store.consume(
            secondNonce, page: trusted, trusted: trusted,
            requestId: secondRequest, sessionId: sessionId
        )
        XCTAssertFalse(firstConsumed)
        XCTAssertFalse(secondConsumed)
    }

    func testChallengeCannotBeIssuedForUntrustedOriginOrInvalidBinding() async throws {
        let trusted = URL(string: "https://workspace.example.test")!
        let foreign = URL(string: "https://attacker.example.test")!
        let store = try BridgeChallengeStore()

        do {
            _ = try await store.issue(
                page: foreign, trusted: trusted,
                requestId: UUID().uuidString, sessionId: UUID().uuidString
            )
            XCTFail("Untrusted page must not receive a challenge.")
        } catch {
            XCTAssertEqual(error as? BridgeChallengeError, .untrustedOrigin)
        }

        do {
            _ = try await store.issue(
                page: trusted, trusted: trusted,
                requestId: "not-a-uuid", sessionId: UUID().uuidString
            )
            XCTFail("Invalid request binding must not receive a challenge.")
        } catch {
            XCTAssertEqual(error as? BridgeChallengeError, .invalidBinding)
        }
    }
}

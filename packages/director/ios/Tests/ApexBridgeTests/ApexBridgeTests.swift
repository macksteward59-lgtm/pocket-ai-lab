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
        await withCheckedContinuation { continuation in
            consumeContinuation = continuation
            startedContinuation?.resume()
            startedContinuation = nil
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
        let originalDate = originalAttributes[.modificationDate] as? Date
        let originalSize = (originalAttributes[.size] as? NSNumber)?.intValue
        try Data("GGUF-MODEL-FIXTURE".utf8).write(to: modelURL, options: .atomic)
        if let originalDate {
            try FileManager.default.setAttributes([.modificationDate: originalDate], ofItemAtPath: modelURL.path)
        }
        let changedAttributes = try FileManager.default.attributesOfItem(atPath: modelURL.path)
        XCTAssertEqual((changedAttributes[.size] as? NSNumber)?.intValue, originalSize)
        XCTAssertEqual(changedAttributes[.modificationDate] as? Date, originalDate)
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
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .unknownSession)
        }

        let reports = await controller.reports()
        let snapshot = await runtime.snapshot()
        XCTAssertTrue(reports.isEmpty)
        XCTAssertTrue(snapshot.loadedModelIDs.isEmpty)
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

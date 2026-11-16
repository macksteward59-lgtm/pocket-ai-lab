import Foundation
import XCTest
import PocketLlamaEngine
@testable import ApexBridge

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
    }

    func testRemoteHTTPIsRejectedButLoopbackHTTPIsAllowed() {
        XCTAssertFalse(BridgeGate.sameOrigin(
            URL(string: "http://workspace.example.test")!,
            trusted: URL(string: "http://workspace.example.test")!
        ))
        XCTAssertTrue(BridgeGate.sameOrigin(
            URL(string: "http://localhost:8080/app")!,
            trusted: URL(string: "http://127.0.0.1:8080")!
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
        XCTAssertEqual(BridgeGate.parse(body, page: page, trusted: trusted, consequentialAuthorized: false), .accepted)

        var shortNonce = body
        shortNonce["challengeNonce"] = "short"
        XCTAssertEqual(BridgeGate.parse(shortNonce, page: page, trusted: trusted, consequentialAuthorized: false), .invalidMessage)

        var extraKey = body
        extraKey["privateKey"] = "must-not-cross-the-bridge"
        XCTAssertEqual(BridgeGate.parse(extraKey, page: page, trusted: trusted, consequentialAuthorized: false), .invalidMessage)
    }

    func testLoadRequiresHostOwnedConsequentialAuthorization() {
        let page = URL(string: "https://workspace.example.test")!
        let trusted = page
        let body: [String: Any] = [
            "id": UUID().uuidString,
            "action": "loadModel",
            "model": "local-model-1",
            "estimatedMemoryMB": 512
        ]
        XCTAssertEqual(BridgeGate.parse(body, page: page, trusted: trusted, consequentialAuthorized: false), .authorizationRequired)
        XCTAssertEqual(BridgeGate.parse(body, page: page, trusted: trusted, consequentialAuthorized: true), .accepted)
    }

    func testUntrustedOriginAndMissingRequiredFieldsFailClosed() {
        let trusted = URL(string: "https://workspace.example.test")!
        let foreign = URL(string: "https://attacker.example.test")!
        let body: [String: Any] = ["id": UUID().uuidString, "action": "getRuntimeStatus"]
        XCTAssertEqual(BridgeGate.parse(body, page: foreign, trusted: trusted, consequentialAuthorized: false), .untrustedOrigin)
        XCTAssertEqual(BridgeGate.parse(["id": UUID().uuidString, "action": "generate"], page: trusted, trusted: trusted, consequentialAuthorized: false), .invalidMessage)
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

private actor StubLlamaEngine: LlamaEngine {
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

final class RuntimeControllerTests: XCTestCase {
    private func makeFixture(clock: TestClock, readinessTTL: TimeInterval = 120) throws -> (RuntimeController, NativeInferenceRuntime, URL, ModelDescriptor) {
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
        let controller = try RuntimeController(
            runtime: runtime,
            deviceId: "test-device",
            runtimeIdentity: "test-runtime",
            readinessTTL: readinessTTL,
            clock: { clock.now() }
        )
        return (controller, runtime, modelURL, descriptor)
    }

    func testLoadRequiresRealReadinessBeforeGenerationAndReturnsUnsignedCandidate() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 1_000))
        let (controller, runtime, modelURL, descriptor) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }

        let loaded = try await controller.load(model: descriptor, estimatedMemoryMB: 256)
        XCTAssertEqual(loaded.phase, "loaded")
        XCTAssertFalse(loaded.canGenerate)
        do {
            _ = try await controller.generate(
                sessionId: loaded.sessionId!, prompt: "hello", requestId: UUID().uuidString,
                conversationRequestId: "conversation-1", attemptId: "attempt-1",
                challengeNonce: "0123456789abcdef"
            )
            XCTFail("Generation must require a fresh readiness probe.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .notReady)
        }

        let ready = try await controller.readiness(sessionId: loaded.sessionId!)
        XCTAssertTrue(ready.canGenerate)
        XCTAssertNotNil(ready.healthCheckId)
        let requestId = UUID().uuidString
        let record = try await controller.generate(
            sessionId: loaded.sessionId!, prompt: "hello", requestId: requestId,
            conversationRequestId: "conversation-1", attemptId: "attempt-1",
            challengeNonce: "0123456789abcdef"
        )
        XCTAssertEqual(record.output, "answer")
        XCTAssertEqual(record.requestId, requestId)
        XCTAssertEqual(record.modelId, descriptor.id)
        XCTAssertEqual(record.modelFileHash, ready.fileHash)
        XCTAssertEqual(record.healthCheckId, ready.healthCheckId)
        XCTAssertEqual(record.challengeNonce, "0123456789abcdef")
        XCTAssertFalse(record.authorized)
        XCTAssertFalse(String(describing: record).contains("signature"))
        XCTAssertTrue(await controller.unload(sessionId: loaded.sessionId!))
        XCTAssertTrue(await controller.reports().isEmpty)
        XCTAssertTrue(await runtime.snapshot().loadedModelIDs.isEmpty)
    }

    func testReadinessExpiresAndCannotBeReused() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 2_000))
        let (controller, _, modelURL, descriptor) = try makeFixture(clock: clock, readinessTTL: 30)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(model: descriptor, estimatedMemoryMB: 256)
        _ = try await controller.readiness(sessionId: loaded.sessionId!)
        clock.advance(31)
        do {
            _ = try await controller.generate(
                sessionId: loaded.sessionId!, prompt: "hello", requestId: UUID().uuidString,
                conversationRequestId: "conversation-1", attemptId: "attempt-1",
                challengeNonce: "0123456789abcdef"
            )
            XCTFail("Expired readiness must fail closed.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .notReady)
        }
    }

    func testModelFileChangeInvalidatesReadinessAndGeneration() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 3_000))
        let (controller, _, modelURL, descriptor) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        let loaded = try await controller.load(model: descriptor, estimatedMemoryMB: 256)
        _ = try await controller.readiness(sessionId: loaded.sessionId!)
        try Data("GGUF-replaced-with-different-size".utf8).write(to: modelURL, options: .atomic)
        do {
            _ = try await controller.generate(
                sessionId: loaded.sessionId!, prompt: "hello", requestId: UUID().uuidString,
                conversationRequestId: "conversation-1", attemptId: "attempt-1",
                challengeNonce: "0123456789abcdef"
            )
            XCTFail("A changed model artifact must invalidate the active session.")
        } catch {
            XCTAssertEqual(error as? RuntimeControllerError, .modelFileChanged)
        }
        XCTAssertFalse((await controller.reports()).first?.canGenerate ?? true)
    }

    func testDisconnectReleasesSessionsAndIdleModels() async throws {
        let clock = TestClock(Date(timeIntervalSince1970: 4_000))
        let (controller, runtime, modelURL, descriptor) = try makeFixture(clock: clock)
        defer { try? FileManager.default.removeItem(at: modelURL.deletingLastPathComponent()) }
        _ = try await controller.load(model: descriptor, estimatedMemoryMB: 256)
        await controller.disconnect()
        XCTAssertTrue(await controller.reports().isEmpty)
        XCTAssertTrue(await runtime.snapshot().loadedModelIDs.isEmpty)
    }
}

import Foundation
import XCTest
@testable import PocketAILab
import PocketLlamaEngine

final class WorkspaceBridgeDispatcherTests: XCTestCase {
    private func makeRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    @MainActor
    private func makeDispatcher(root: URL) -> WorkspaceBridgeDispatcher {
        let composition = NativeRuntimeComposition(
            engine: DispatcherStubEngine(),
            availableMemoryMB: { 4_096 }
        )
        let catalog = LocalModelCatalogStore(
            fileURL: root.appendingPathComponent("ModelCatalog.json"),
            modelDirectory: root.appendingPathComponent("Models", isDirectory: true)
        )
        return WorkspaceBridgeDispatcher(
            trustedURL: URL(string: "https://workspace.example.test/app")!,
            runtimeDependency: composition.dependency,
            modelCatalogStore: catalog
        )
    }

    @MainActor
    private func makeLoadedDispatcher(root: URL) async throws -> (WorkspaceBridgeDispatcher, String, NativeRuntimeComposition) {
        let modelDirectory = root.appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)
        let modelURL = modelDirectory.appendingPathComponent("dispatcher-test.gguf")
        try Data("GGUF-test-model-fixture".utf8).write(to: modelURL)
        let fingerprint = try ModelArtifactFingerprint.compute(at: modelURL)
        let catalog = LocalModelCatalogStore(
            fileURL: root.appendingPathComponent("ModelCatalog.json"),
            modelDirectory: modelDirectory
        )
        let snapshot = try catalog.register(
            ImportedModelArtifact(url: modelURL, fingerprint: fingerprint),
            displayName: "Dispatcher test model"
        )
        let entry = try XCTUnwrap(snapshot.entries.first)
        let descriptor = ModelDescriptor(
            id: entry.id,
            name: entry.name,
            path: modelURL.path,
            contextLength: entry.contextLength,
            quantization: entry.quantization
        )
        let composition = NativeRuntimeComposition(
            engine: DispatcherStubEngine(),
            availableMemoryMB: { 4_096 }
        )
        let runtime = try XCTUnwrap(composition.runtime)
        guard case .shared(let service) = composition.dependency else {
            throw XCTSkip("Shared runtime composition unavailable in test fixture.")
        }
        let lease = try await runtime.acquire(model: descriptor, estimatedMemoryMB: entry.estimatedMemoryMB)
        try service.retain(lease, for: UUID())
        let dispatcher = WorkspaceBridgeDispatcher(
            trustedURL: URL(string: "https://workspace.example.test/app")!,
            runtimeDependency: composition.dependency,
            modelCatalogStore: catalog
        )
        return (dispatcher, lease.session.id, composition)
    }

    @MainActor
    func testTrustedMainFrameCanReadAppScopedRuntimeStatus() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let dispatcher = makeDispatcher(root: root)
        let messageID = UUID().uuidString

        let response = await dispatcher.handle(
            body: ["id": messageID, "action": "getRuntimeStatus"],
            frameOrigin: URL(string: "https://workspace.example.test/")!,
            isMainFrame: true
        )

        XCTAssertEqual(response["id"] as? String, messageID)
        XCTAssertEqual(response["ok"] as? Bool, true)
        let data = try XCTUnwrap(response["data"] as? [String: Any])
        XCTAssertEqual(data["runtimeAvailable"] as? Bool, true)
        XCTAssertEqual(data["modelLoaded"] as? Bool, false)
        XCTAssertEqual(data["generationEnabled"] as? Bool, false)
        XCTAssertEqual(data["dispatcherMode"] as? String, "read-only-until-ready")
        XCTAssertEqual((data["activeLocalSessions"] as? [[String: Any]])?.count, 0)
        XCTAssertEqual(data["runtimeTrust"] as? String, "Unverified")
    }

    @MainActor
    func testTrustedMainFrameCanReadSanitizedModelCatalog() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let dispatcher = makeDispatcher(root: root)

        let response = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "listModels"],
            frameOrigin: URL(string: "https://workspace.example.test/")!,
            isMainFrame: true
        )

        XCTAssertEqual(response["ok"] as? Bool, true)
        let data = try XCTUnwrap(response["data"] as? [String: Any])
        let models = try XCTUnwrap(data["models"] as? [[String: Any]])
        XCTAssertTrue(models.isEmpty)
    }

    @MainActor
    func testForeignOriginSubframeAndMalformedMessagesAreRejected() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let dispatcher = makeDispatcher(root: root)
        let body: [String: Any] = ["id": UUID().uuidString, "action": "getRuntimeStatus"]

        let foreign = await dispatcher.handle(
            body: body,
            frameOrigin: URL(string: "https://attacker.example.test/")!,
            isMainFrame: true
        )
        XCTAssertEqual(foreign["error"] as? String, "untrusted_origin")

        let subframe = await dispatcher.handle(
            body: body,
            frameOrigin: URL(string: "https://workspace.example.test/")!,
            isMainFrame: false
        )
        XCTAssertEqual(subframe["error"] as? String, "main_frame_required")

        var extraField = body
        extraField["origin"] = "https://workspace.example.test"
        let malformed = await dispatcher.handle(
            body: extraField,
            frameOrigin: URL(string: "https://workspace.example.test/")!,
            isMainFrame: true
        )
        XCTAssertEqual(malformed["error"] as? String, "invalid_message")

        let oversized = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "getRuntimeStatus",
                "padding": String(repeating: "x", count: 41_000)
            ],
            frameOrigin: URL(string: "https://workspace.example.test/")!,
            isMainFrame: true
        )
        XCTAssertEqual(oversized["error"] as? String, "invalid_message")
    }

    @MainActor
    func testGenerationAndConsequentialActionsRemainDisabled() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let dispatcher = makeDispatcher(root: root)
        let trustedOrigin = URL(string: "https://workspace.example.test/")!

        let generation = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "generate",
                "sessionId": UUID().uuidString,
                "prompt": "This must not reach inference",
                "requestId": UUID().uuidString,
                "conversationRequestId": "conversation-1",
                "attemptId": "attempt-1",
                "challengeNonce": String(repeating: "a", count: 32)
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(generation["error"] as? String, "model_not_loaded_or_session_mismatch")

        let load = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "loadModel", "model": "model-1"],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(load["error"] as? String, "authorization_required")
    }

    @MainActor
    func testHostChallengeGatesGenerationOnExactSharedRuntimeSession() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let (dispatcher, sessionID, composition) = try await makeLoadedDispatcher(root: root)
        _ = composition
        let trustedOrigin = URL(string: "https://workspace.example.test/")!
        let requestID = UUID().uuidString

        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true)
        let readinessData = try XCTUnwrap(readiness["data"] as? [String: Any])
        XCTAssertEqual(readinessData["canGenerate"] as? Bool, true)

        let authorization = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "authorizeGeneration",
                "sessionId": sessionID,
                "requestId": requestID
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(authorization["ok"] as? Bool, true)
        let authorizationData = try XCTUnwrap(authorization["data"] as? [String: Any])
        let nonce = try XCTUnwrap(authorizationData["challengeNonce"] as? String)

        let generationBody: [String: Any] = [
            "id": UUID().uuidString,
            "action": "generate",
            "sessionId": sessionID,
            "prompt": "Answer from the local test engine.",
            "requestId": requestID,
            "conversationRequestId": "conversation-1",
            "attemptId": "attempt-1",
            "challengeNonce": nonce
        ]
        await dispatcher.navigationStarted()
        let invalidated = await dispatcher.handle(
            body: generationBody,
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(invalidated["error"] as? String, "generation_failed")
        XCTAssertTrue((invalidated["detail"] as? String ?? "").contains("unauthorizedChallenge"))

        let refreshedAuthorization = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "authorizeGeneration",
                "sessionId": sessionID,
                "requestId": requestID
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(refreshedAuthorization["ok"] as? Bool, true)
        let refreshedData = try XCTUnwrap(refreshedAuthorization["data"] as? [String: Any])
        let refreshedNonce = try XCTUnwrap(refreshedData["challengeNonce"] as? String)
        var refreshedGenerationBody = generationBody
        refreshedGenerationBody["challengeNonce"] = refreshedNonce

        let generation = await dispatcher.handle(
            body: refreshedGenerationBody,
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(generation["ok"] as? Bool, true)
        let generationData = try XCTUnwrap(generation["data"] as? [String: Any])
        XCTAssertEqual(generationData["output"] as? String, "stub")
        XCTAssertEqual(generationData["runtimeSessionId"] as? String, sessionID)
        XCTAssertEqual(generationData["authorized"] as? Bool, false)

        var replayBody = refreshedGenerationBody
        // Preserve the exact request/session/nonce binding. Only the message
        // envelope ID changes, so this specifically proves one-use consumption.
        replayBody["id"] = UUID().uuidString
        let replay = await dispatcher.handle(
            body: replayBody,
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(replay["error"] as? String, "generation_failed")
        XCTAssertTrue((replay["detail"] as? String ?? "").contains("unauthorizedChallenge"))
    }

    @MainActor
    func testInvalidationDisablesAllFurtherMessages() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let dispatcher = makeDispatcher(root: root)
        dispatcher.invalidate()

        let response = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "getRuntimeStatus"],
            frameOrigin: URL(string: "https://workspace.example.test/")!,
            isMainFrame: true
        )
        XCTAssertEqual(response["error"] as? String, "bridge_unavailable")
    }
}

private actor DispatcherStubEngine: LlamaEngine {
    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        AsyncThrowingStream { continuation in
            continuation.yield(Token(text: "stub", isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
}

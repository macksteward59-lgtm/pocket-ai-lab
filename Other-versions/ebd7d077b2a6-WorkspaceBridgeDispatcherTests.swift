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
    private func makeLoadedDispatcher(
        root: URL,
        engine: any LlamaEngine = DispatcherStubEngine(),
        beforeSessionResolution: (@MainActor () async -> Void)? = nil,
        beforeNavigationCleanup: (@MainActor () async -> Void)? = nil
    ) async throws -> (WorkspaceBridgeDispatcher, String, NativeRuntimeComposition) {
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
            engine: engine,
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
            modelCatalogStore: catalog,
            beforeSessionResolution: beforeSessionResolution,
            beforeNavigationCleanup: beforeNavigationCleanup
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

        // The failed attempt has retired its request and attempt identities.
        // A fresh authorization must use a fresh pair rather than replaying them.
        let refreshedRequestID = UUID().uuidString
        let refreshedAttemptID = "attempt-2"
        let refreshedAuthorization = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "authorizeGeneration",
                "sessionId": sessionID,
                "requestId": refreshedRequestID
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(refreshedAuthorization["ok"] as? Bool, true)
        let refreshedData = try XCTUnwrap(refreshedAuthorization["data"] as? [String: Any])
        let refreshedNonce = try XCTUnwrap(refreshedData["challengeNonce"] as? String)
        var refreshedGenerationBody = generationBody
        refreshedGenerationBody["requestId"] = refreshedRequestID
        refreshedGenerationBody["attemptId"] = refreshedAttemptID
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
        XCTAssertTrue(
            (replay["detail"] as? String ?? "").contains("duplicateRequest"),
            "A settled request identity must be retired before challenge replay validation."
        )
    }

    @MainActor
    func testCancellationBeforeAuthorizationPreventsChallengeIssuance() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let (dispatcher, sessionID, _) = try await makeLoadedDispatcher(root: root)
        let trustedOrigin = URL(string: "https://workspace.example.test/")!
        let requestID = UUID().uuidString

        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true)

        let cancellation = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "cancelGeneration",
                "sessionId": sessionID,
                "requestId": requestID
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(cancellation["ok"] as? Bool, true)
        XCTAssertEqual((cancellation["data"] as? [String: Any])?["cancelled"] as? Bool, true)

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
        XCTAssertEqual(authorization["ok"] as? Bool, false)
        XCTAssertEqual(authorization["error"] as? String, "request_retired")
        XCTAssertNil((authorization["data"] as? [String: Any])?["challengeNonce"])
    }

    @MainActor
    func testCancellationDeliveredBeforeGenerateBlocksExactDispatcherRequest() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let (dispatcher, sessionID, _) = try await makeLoadedDispatcher(root: root)
        let trustedOrigin = URL(string: "https://workspace.example.test/")!
        let requestID = UUID().uuidString

        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true)

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

        // Simulate WebKit delivering the cancel message before the generate
        // message for the same exact session/request pair.
        let cancellation = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "cancelGeneration",
                "sessionId": sessionID,
                "requestId": requestID
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(cancellation["ok"] as? Bool, true)
        let cancellationData = try XCTUnwrap(cancellation["data"] as? [String: Any])
        XCTAssertEqual(cancellationData["cancelled"] as? Bool, true)

        let generation = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "generate",
                "sessionId": sessionID,
                "prompt": "This request was cancelled before generation dispatch.",
                "requestId": requestID,
                "conversationRequestId": "cancel-before-dispatch",
                "attemptId": "cancel-before-dispatch-attempt",
                "challengeNonce": nonce
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(generation["ok"] as? Bool, false)
        XCTAssertEqual(generation["error"] as? String, "generation_failed")
        XCTAssertNil((generation["data"] as? [String: Any])?["output"])
    }

    @MainActor
    func testInFlightSessionResolutionCannotAuthorizeAfterInvalidation() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = DispatcherResolutionGate()
        let (dispatcher, sessionID, _) = try await makeLoadedDispatcher(
            root: root,
            beforeSessionResolution: { await gate.pauseIfArmed() }
        )
        let trustedOrigin = URL(string: "https://workspace.example.test/")!

        // Establish the shared controller session before arming the deterministic pause.
        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true)

        await gate.arm()
        let request = Task {
            await dispatcher.handle(
                body: [
                    "id": UUID().uuidString,
                    "action": "authorizeGeneration",
                    "sessionId": sessionID,
                    "requestId": UUID().uuidString
                ],
                frameOrigin: trustedOrigin,
                isMainFrame: true
            )
        }
        await gate.waitUntilEntered()
        dispatcher.invalidate()
        await gate.resume()

        let response = await request.value
        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertEqual(response["error"] as? String, "runtime_not_ready")
    }

    @MainActor
    func testInFlightGenerationCannotReachControllerAfterInvalidation() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = DispatcherResolutionGate()
        let (dispatcher, sessionID, _) = try await makeLoadedDispatcher(
            root: root,
            beforeSessionResolution: { await gate.pauseIfArmed() }
        )
        let trustedOrigin = URL(string: "https://workspace.example.test/")!
        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true)

        await gate.arm()
        let request = Task {
            await dispatcher.handle(
                body: [
                    "id": UUID().uuidString,
                    "action": "generate",
                    "sessionId": sessionID,
                    "prompt": "This request must not reach native inference.",
                    "requestId": UUID().uuidString,
                    "conversationRequestId": "invalidation-race",
                    "attemptId": "invalidation-race-attempt",
                    "challengeNonce": String(repeating: "a", count: 32)
                ],
                frameOrigin: trustedOrigin,
                isMainFrame: true
            )
        }
        await gate.waitUntilEntered()
        dispatcher.invalidate()
        await gate.resume()

        let response = await request.value
        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertEqual(response["error"] as? String, "model_not_loaded_or_session_mismatch")
    }

    @MainActor
    func testInFlightAuthorizationCannotIssueChallengeAfterNavigation() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = DispatcherResolutionGate()
        let (dispatcher, sessionID, _) = try await makeLoadedDispatcher(
            root: root,
            beforeSessionResolution: { await gate.pauseIfArmed() }
        )
        let trustedOrigin = URL(string: "https://workspace.example.test/")!
        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true)

        await gate.arm()
        let request = Task {
            await dispatcher.handle(
                body: [
                    "id": UUID().uuidString,
                    "action": "authorizeGeneration",
                    "sessionId": sessionID,
                    "requestId": UUID().uuidString
                ],
                frameOrigin: trustedOrigin,
                isMainFrame: true
            )
        }
        await gate.waitUntilEntered()
        await dispatcher.navigationStarted()
        await gate.resume()

        let response = await request.value
        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertEqual(response["error"] as? String, "runtime_not_ready")

        // Navigation invalidates old work but leaves the trusted bridge usable
        // for the newly committed same-origin document.
        let status = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "getRuntimeStatus"],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(status["ok"] as? Bool, true)
    }

    @MainActor
    func testNavigationBarrierIsRaisedSynchronouslyBeforeCleanupIsScheduled() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = DispatcherResolutionGate()
        let (dispatcher, sessionID, _) = try await makeLoadedDispatcher(
            root: root,
            beforeNavigationCleanup: { await gate.pauseIfArmed() }
        )
        let trustedOrigin = URL(string: "https://workspace.example.test/")!
        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true)

        await gate.arm()
        let navigationGeneration = try XCTUnwrap(dispatcher.beginNavigation())

        // This message is handled before asynchronous cleanup is even scheduled.
        // The synchronous barrier must already prevent a new document from
        // obtaining a generation challenge.
        let blocked = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "authorizeGeneration",
                "sessionId": sessionID,
                "requestId": UUID().uuidString
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(blocked["ok"] as? Bool, false)
        XCTAssertEqual(blocked["error"] as? String, "runtime_not_ready")

        let cleanup = Task { await dispatcher.finishNavigation(navigationGeneration) }
        await gate.waitUntilEntered()
        await gate.resume()
        await cleanup.value

        let allowedAfterCleanup = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "authorizeGeneration",
                "sessionId": sessionID,
                "requestId": UUID().uuidString
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(allowedAfterCleanup["ok"] as? Bool, true)
    }

    @MainActor
    func testNewDocumentCannotAuthorizeWhileNavigationCleanupIsPending() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = DispatcherResolutionGate()
        let (dispatcher, sessionID, _) = try await makeLoadedDispatcher(
            root: root,
            beforeNavigationCleanup: { await gate.pauseIfArmed() }
        )
        let trustedOrigin = URL(string: "https://workspace.example.test/")!
        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true, "Authorization after cleanup should be tested against a ready session.")

        await gate.arm()
        let navigation = Task { await dispatcher.navigationStarted() }
        await gate.waitUntilEntered()

        let blocked = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "authorizeGeneration",
                "sessionId": sessionID,
                "requestId": UUID().uuidString
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(blocked["ok"] as? Bool, false)
        XCTAssertEqual(blocked["error"] as? String, "runtime_not_ready")

        await gate.resume()
        await navigation.value

        let allowedAfterCleanup = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "authorizeGeneration",
                "sessionId": sessionID,
                "requestId": UUID().uuidString
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(allowedAfterCleanup["ok"] as? Bool, true)
    }

    @MainActor
    func testOlderNavigationCleanupCannotReleaseNewerNavigationBarrier() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let gate = SequencedNavigationGate()
        let (dispatcher, sessionID, _) = try await makeLoadedDispatcher(
            root: root,
            beforeNavigationCleanup: { await gate.pauseIfArmed() }
        )
        let trustedOrigin = URL(string: "https://workspace.example.test/")!
        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true)

        await gate.arm(pausing: [1, 2])
        let olderNavigation = Task { await dispatcher.navigationStarted() }
        await gate.waitUntilEntered(1)
        let newerNavigation = Task { await dispatcher.navigationStarted() }
        await gate.waitUntilEntered(2)

        // Let the older cleanup finish first. Its generation is stale and it
        // must not clear the barrier owned by the still-pending newer navigation.
        await gate.resume(1)
        await olderNavigation.value
        let blockedWhileNewerCleanupPending = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "authorizeGeneration",
                "sessionId": sessionID,
                "requestId": UUID().uuidString
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(blockedWhileNewerCleanupPending["ok"] as? Bool, false)
        XCTAssertEqual(blockedWhileNewerCleanupPending["error"] as? String, "runtime_not_ready")

        await gate.resume(2)
        await newerNavigation.value
        let allowedAfterNewestCleanup = await dispatcher.handle(
            body: [
                "id": UUID().uuidString,
                "action": "authorizeGeneration",
                "sessionId": sessionID,
                "requestId": UUID().uuidString
            ],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(allowedAfterNewestCleanup["ok"] as? Bool, true)
    }

    @MainActor
    func testDispatcherInvalidationReleasesOnlyItsOwnSharedRuntimeLease() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let (dispatcher, sessionID, composition) = try await makeLoadedDispatcher(root: root)
        guard case .shared(let service) = composition.dependency,
              let runtime = composition.runtime else {
            throw XCTSkip("Shared runtime composition unavailable in test fixture.")
        }

        let trustedOrigin = URL(string: "https://workspace.example.test/")!
        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin,
            isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true)

        let beforeInvalidation = await runtime.snapshot()
        XCTAssertEqual(beforeInvalidation.activeLeaseCount, 2, "Local AI and Workspace controller must own distinct consumer leases.")
        XCTAssertEqual(service.activeLeases().count, 1)

        dispatcher.invalidate()

        let deadline = Date().addingTimeInterval(5)
        var afterInvalidation = await runtime.snapshot()
        while afterInvalidation.activeLeaseCount != 1, Date() < deadline {
            try await Task.sleep(nanoseconds: 10_000_000)
            afterInvalidation = await runtime.snapshot()
        }

        XCTAssertEqual(afterInvalidation.activeLeaseCount, 1, "Workspace teardown must release its controller lease.")
        XCTAssertEqual(afterInvalidation.activeUseCount, 0)
        let retainedLocalAILeases = service.activeLeases()
        let retainedLocalAILease = try XCTUnwrap(
            retainedLocalAILeases.first,
            "The Local AI consumer lease must remain active after Workspace teardown."
        )
        XCTAssertEqual(retainedLocalAILeases.count, 1)
        XCTAssertEqual(afterInvalidation.loadedModelIDs, [retainedLocalAILease.model.id], "The Local AI lease must keep the shared native model resident.")
        XCTAssertEqual(retainedLocalAILease.session.id, sessionID, "Workspace teardown must not release the Local AI consumer's exact session lease.")
    }

    @MainActor
    func testDispatcherInvalidationDrainsActiveGenerationBeforeReleasingOnlyWorkspaceLease() async throws {
        let root = try makeRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let engine = DispatcherBlockingDrainLlamaEngine()
        let (dispatcher, sessionID, composition) = try await makeLoadedDispatcher(root: root, engine: engine)
        guard case .shared(let service) = composition.dependency,
              let runtime = composition.runtime else {
            throw XCTSkip("Shared runtime composition unavailable in test fixture.")
        }
        let trustedOrigin = URL(string: "https://workspace.example.test/")!
        let requestID = UUID().uuidString
        let readiness = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "checkReadiness", "sessionId": sessionID],
            frameOrigin: trustedOrigin, isMainFrame: true
        )
        XCTAssertEqual(readiness["ok"] as? Bool, true)
        let authorization = await dispatcher.handle(
            body: ["id": UUID().uuidString, "action": "authorizeGeneration", "sessionId": sessionID, "requestId": requestID],
            frameOrigin: trustedOrigin, isMainFrame: true
        )
        XCTAssertEqual(authorization["ok"] as? Bool, true)
        let authorizationData = try XCTUnwrap(authorization["data"] as? [String: Any])
        let nonce = try XCTUnwrap(authorizationData["challengeNonce"] as? String)
        let generation = Task {
            await dispatcher.handle(
                body: [
                    "id": UUID().uuidString, "action": "generate", "sessionId": sessionID,
                    "prompt": "Hold this generation until dispatcher teardown drains it.",
                    "requestId": requestID, "conversationRequestId": "dispatcher-drain",
                    "attemptId": "dispatcher-drain-attempt", "challengeNonce": nonce
                ],
                frameOrigin: trustedOrigin, isMainFrame: true
            )
        }
        await engine.waitUntilGenerationStarted()
        let beforeInvalidation = await runtime.snapshot()
        XCTAssertEqual(beforeInvalidation.activeLeaseCount, 2)
        XCTAssertEqual(beforeInvalidation.activeUseCount, 1)
        XCTAssertEqual(beforeInvalidation.loadedModelIDs.count, 1)
        dispatcher.invalidate()
        await engine.waitUntilDrainStarted()
        let whileDraining = await runtime.snapshot()
        XCTAssertEqual(whileDraining.activeLeaseCount, 2)
        XCTAssertEqual(whileDraining.activeUseCount, 1)
        XCTAssertEqual(whileDraining.loadedModelIDs.count, 1)
        XCTAssertEqual(service.activeLeases().map(\.session.id), [sessionID])
        await engine.finishDrain()
        let response = await generation.value
        let deadline = Date().addingTimeInterval(5)
        var afterDrain = await runtime.snapshot()
        while afterDrain.activeLeaseCount != 1, Date() < deadline {
            try await Task.sleep(nanoseconds: 10_000_000)
            afterDrain = await runtime.snapshot()
        }
        XCTAssertEqual(response["ok"] as? Bool, false)
        XCTAssertNil((response["data"] as? [String: Any])?["output"])
        XCTAssertEqual(afterDrain.activeLeaseCount, 1)
        XCTAssertEqual(afterDrain.activeUseCount, 0)
        let retainedLocalAILeases = service.activeLeases()
        let retainedLocalAILease = try XCTUnwrap(
            retainedLocalAILeases.first,
            "The Local AI consumer lease must remain active after Workspace teardown."
        )
        XCTAssertEqual(retainedLocalAILeases.count, 1)
        XCTAssertEqual(afterDrain.loadedModelIDs, [retainedLocalAILease.model.id])
        XCTAssertEqual(retainedLocalAILease.session.id, sessionID)
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

private actor DispatcherBlockingDrainLlamaEngine: LlamaEngine {
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
                } catch { continuation.finish(throwing: error) }
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
        await withCheckedContinuation { generationStartedContinuation = $0 }
    }
    func waitUntilDrainStarted() async {
        if drainContinuation != nil { return }
        await withCheckedContinuation { drainStartedContinuation = $0 }
    }
    func finishDrain() {
        drainContinuation?.resume()
        drainContinuation = nil
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


private actor SequencedNavigationGate {
    private var invocationCount = 0
    private var pausedInvocations: Set<Int> = []
    private var enteredInvocations: Set<Int> = []
    private var enteredWaiters: [Int: CheckedContinuation<Void, Never>] = [:]
    private var resumeWaiters: [Int: CheckedContinuation<Void, Never>] = [:]

    func arm(pausing invocations: Set<Int>) {
        invocationCount = 0
        pausedInvocations = invocations
        enteredInvocations.removeAll()
        enteredWaiters.removeAll()
        resumeWaiters.removeAll()
    }

    func pauseIfArmed() async {
        invocationCount += 1
        let invocation = invocationCount
        guard pausedInvocations.contains(invocation) else { return }
        enteredInvocations.insert(invocation)
        enteredWaiters.removeValue(forKey: invocation)?.resume()
        await withCheckedContinuation { continuation in
            resumeWaiters[invocation] = continuation
        }
    }

    func waitUntilEntered(_ invocation: Int) async {
        if enteredInvocations.contains(invocation) { return }
        await withCheckedContinuation { continuation in
            enteredWaiters[invocation] = continuation
        }
    }

    func resume(_ invocation: Int) {
        pausedInvocations.remove(invocation)
        resumeWaiters.removeValue(forKey: invocation)?.resume()
    }
}

private actor DispatcherResolutionGate {
    private var armed = false
    private var entered = false
    private var enteredWaiter: CheckedContinuation<Void, Never>?
    private var resumeWaiter: CheckedContinuation<Void, Never>?

    func arm() { armed = true }

    func pauseIfArmed() async {
        guard armed else { return }
        armed = false
        entered = true
        enteredWaiter?.resume()
        enteredWaiter = nil
        await withCheckedContinuation { continuation in
            resumeWaiter = continuation
        }
    }

    func waitUntilEntered() async {
        if entered { return }
        await withCheckedContinuation { continuation in
            enteredWaiter = continuation
        }
    }

    func resume() {
        resumeWaiter?.resume()
        resumeWaiter = nil
    }
}

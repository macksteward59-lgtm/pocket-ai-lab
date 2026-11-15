import XCTest
@testable import PocketAILab
import PocketLlamaEngine

final class PocketAILabTests: XCTestCase {
    func testUnavailableProbeNeverClaimsMetalReady() {
        let probe = LlamaCppMetalBackend.probe()
        if !probe.linked { XCTAssertFalse(probe.metalDeviceUsable) }
        if !probe.metalBackendRegistered { XCTAssertFalse(probe.metalDeviceUsable) }
    }

    func testRuntimeTrustRemainsUnverifiedUntilTrustedLeaseIntegrationExists() {
        XCTAssertEqual(RuntimeTrustPresentation.stateLabel, "Unverified")
        XCTAssertFalse(RuntimeTrustPresentation.isVerified)
        XCTAssertTrue(RuntimeTrustPresentation.detail.contains("server-issued runtime lease"))
        XCTAssertTrue(RuntimeTrustPresentation.statusMessage(after: "Model loaded").contains("Runtime trust remains unverified"))
    }

    @MainActor
    func testAgentTeamRunsSixLogicalRolesOnOneSessionAndKeepsTrustUnverified() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("team-model.gguf")
        try Data("GGUF-team-model".utf8).write(to: source)

        let engine = TestLlamaEngine()
        let model = LocalChatModel(
            modelDirectory: root.appendingPathComponent("models", isDirectory: true),
            engine: engine
        )
        try await model.importModel(from: source)
        await model.loadModel()
        await model.runAgentTeam("Review the architecture and identify its main risks.")

        let generatedSessions = await engine.generatedSessionIDs()
        XCTAssertEqual(generatedSessions.count, 6)
        XCTAssertEqual(Set(generatedSessions).count, 1)
        XCTAssertEqual(model.trustStatus, "Unverified")
        XCTAssertTrue(model.status.contains("6 sequential logical roles shared one local model session"))
        XCTAssertTrue(model.messages.contains(where: { $0.role.contains("reasoner") }))
        XCTAssertTrue(model.messages.contains(where: { $0.role.contains("researcher") }))
        XCTAssertTrue(model.messages.contains(where: { $0.role.contains("security-analyst") }))
        XCTAssertTrue(model.messages.contains(where: { $0.role.contains("critic") }))
        XCTAssertTrue(model.messages.contains(where: { $0.role.contains("validator") }))
    }

    @MainActor
    func testImportingAnExistingDocumentsModelDoesNotDeleteItsSource() async throws {
        let directory = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let modelURL = directory.appendingPathComponent("already-imported.gguf")
        let original = Data("GGUF\u{00}fixture".utf8)
        try original.write(to: modelURL)

        let model = LocalChatModel(modelDirectory: directory, engine: TestLlamaEngine())
        try await model.importModel(from: modelURL)

        XCTAssertEqual(model.modelURL, modelURL)
        XCTAssertEqual(try Data(contentsOf: modelURL), original)
        XCTAssertEqual(model.modelName, "already-imported.gguf")
    }

    @MainActor
    func testFailedReplacementPreservesPreviousModelAndSelection() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let goodSourceDirectory = root.appendingPathComponent("good-source", isDirectory: true)
        let invalidSourceDirectory = root.appendingPathComponent("invalid-source", isDirectory: true)
        let modelDirectory = root.appendingPathComponent("models", isDirectory: true)
        try FileManager.default.createDirectory(at: goodSourceDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: invalidSourceDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)

        let goodSource = goodSourceDirectory.appendingPathComponent("model.gguf")
        let invalidSource = invalidSourceDirectory.appendingPathComponent("model.gguf")
        let destination = modelDirectory.appendingPathComponent("model.gguf")
        let existingBytes = Data("GGUF-existing-good-model".utf8)
        try existingBytes.write(to: goodSource)
        try Data("NOTG-invalid-replacement".utf8).write(to: invalidSource)

        let engine = TestLlamaEngine()
        let model = LocalChatModel(modelDirectory: modelDirectory, engine: engine)
        try await model.importModel(from: goodSource)
        await model.loadModel()
        let originalSessions = await engine.loadedSessionIDs()
        XCTAssertEqual(originalSessions.count, 1)

        do {
            try await model.importModel(from: invalidSource)
            XCTFail("A file without the GGUF magic must be rejected")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("GGUF"))
        }

        XCTAssertEqual(model.modelURL, destination)
        XCTAssertEqual(model.modelName, "model.gguf")
        XCTAssertEqual(try Data(contentsOf: destination), existingBytes)

        await model.send("Use the original model session")
        let unloadedSessions = await engine.unloadedSessionIDs()
        let generatedSessions = await engine.generatedSessionIDs()
        XCTAssertTrue(unloadedSessions.isEmpty)
        XCTAssertEqual(generatedSessions, originalSessions)
        XCTAssertEqual(model.messages.last?.text, "test output")
    }

    @MainActor
    func testValidReimportReplacesExistingModelWithoutTouchingTheSource() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let sourceDirectory = root.appendingPathComponent("source", isDirectory: true)
        let modelDirectory = root.appendingPathComponent("models", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)

        let source = sourceDirectory.appendingPathComponent("model.gguf")
        let destination = modelDirectory.appendingPathComponent("model.gguf")
        let oldBytes = Data("GGUF-old-model".utf8)
        let newBytes = Data("GGUF-new-model".utf8)
        try oldBytes.write(to: destination)
        try newBytes.write(to: source)

        let model = LocalChatModel(modelDirectory: modelDirectory, engine: TestLlamaEngine())
        try await model.importModel(from: source)

        XCTAssertEqual(model.modelURL, destination)
        XCTAssertEqual(try Data(contentsOf: destination), newBytes)
        XCTAssertEqual(try Data(contentsOf: source), newBytes)
    }

    func testWorkspaceURLsRequireAHostAndSecureScheme() {
        XCTAssertTrue(isAllowedWorkspaceURL(URL(string: "https://workspace.example")!))
        XCTAssertTrue(isAllowedWorkspaceURL(URL(string: "http://localhost:8080")!))
        XCTAssertTrue(isAllowedWorkspaceURL(URL(string: "http://127.0.0.1:8080")!))
        XCTAssertTrue(isAllowedWorkspaceURL(URL(string: "http://[::1]:8080")!))
        XCTAssertFalse(isAllowedWorkspaceURL(URL(string: "https:/workspace")!))
        XCTAssertFalse(isAllowedWorkspaceURL(URL(string: "http://workspace.example")!))
        XCTAssertFalse(isAllowedWorkspaceURL(URL(string: "https://user:password@workspace.example")!))
        XCTAssertFalse(isAllowedWorkspaceURL(URL(string: "file:///tmp/workspace.html")!))
    }

    func testWorkspaceRestoresSavedAddressOnlyOnce() {
        var gate = WorkspaceRestoreGate()
        XCTAssertTrue(gate.beginRestore())
        XCTAssertFalse(gate.beginRestore())
        XCTAssertTrue(gate.hasRestoredSavedAddress)
    }

    func testWorkspaceWebViewReloadsOnlyForExplicitOpenRequests() {
        let coordinator = PrivateWorkspaceWebView.Coordinator()
        let firstRequest = UUID()
        XCTAssertTrue(coordinator.shouldLoad(firstRequest))
        XCTAssertFalse(coordinator.shouldLoad(firstRequest))
        XCTAssertTrue(coordinator.shouldLoad(UUID()))
    }

    @MainActor
    func testImportingAnotherModelUnloadsThePreviousSessionBeforePrompting() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let sourceA = root.appendingPathComponent("model-a.gguf")
        let sourceB = root.appendingPathComponent("model-b.gguf")
        try Data("GGUF-model-a".utf8).write(to: sourceA)
        try Data("GGUF-model-b".utf8).write(to: sourceB)

        let engine = TestLlamaEngine()
        let model = LocalChatModel(
            modelDirectory: root.appendingPathComponent("models", isDirectory: true),
            engine: engine
        )
        try await model.importModel(from: sourceA)
        await model.loadModel()
        let loadedSessions = await engine.loadedSessionIDs()
        XCTAssertEqual(loadedSessions.count, 1)

        try await model.importModel(from: sourceB)
        await model.send("Do not use the previous model")
        let unloaded = await engine.unloadedSessionIDs()
        let generated = await engine.generatedSessionIDs()

        XCTAssertEqual(unloaded, loadedSessions)
        XCTAssertTrue(generated.isEmpty)
        XCTAssertEqual(model.modelName, "model-b.gguf")
        XCTAssertTrue(model.status.contains("Load the selected model"))
    }

    @MainActor
    func testOnlyGGUFModelFilesAreAcceptedByTheRealImporter() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let valid = root.appendingPathComponent("valid.gguf")
        let invalid = root.appendingPathComponent("invalid.gguf")
        try Data("GGUF-valid-fixture".utf8).write(to: valid)
        try Data("NOPE-invalid-fixture".utf8).write(to: invalid)

        let model = LocalChatModel(
            modelDirectory: root.appendingPathComponent("models", isDirectory: true),
            engine: TestLlamaEngine()
        )
        try await model.importModel(from: valid)
        XCTAssertEqual(model.modelURL?.lastPathComponent, "valid.gguf")

        do {
            try await model.importModel(from: invalid)
            XCTFail("Invalid GGUF content must be rejected")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("GGUF"))
        }
        XCTAssertEqual(model.modelURL?.lastPathComponent, "valid.gguf")
        XCTAssertTrue(FileManager.default.fileExists(atPath: model.modelURL!.path))
    }

    func testModelArtifactFingerprintUsesStreamingSHA256() throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("fingerprint.gguf")
        let bytes = Data("GGUF-fingerprint-fixture".utf8)
        try bytes.write(to: file)

        let fingerprint = try ModelArtifactFingerprint.compute(at: file)
        XCTAssertEqual(fingerprint.sha256, "4a0ae22e3e562bbb3e742b2ad5a8dd87013f48dca67df5757e819772488dd69d")
        XCTAssertEqual(fingerprint.byteCount, UInt64(bytes.count))
    }

    @MainActor
    func testChangedModelFileIsRejectedBeforeNativeLoad() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        let modelDirectory = root.appendingPathComponent("models", isDirectory: true)
        try Data("GGUF-original".utf8).write(to: source)

        let engine = TestLlamaEngine()
        let model = LocalChatModel(modelDirectory: modelDirectory, engine: engine)
        try await model.importModel(from: source)
        let destination = try XCTUnwrap(model.modelURL)
        try Data("GGUF-tampered".utf8).write(to: destination)

        await model.loadModel()
        let loadCalls = await engine.loadCallCount()
        let loaded = await engine.loadedSessionIDs()
        XCTAssertEqual(loadCalls, 0)
        XCTAssertTrue(loaded.isEmpty)
        XCTAssertTrue(model.status.contains("changed after import"))
    }

    @MainActor
    func testNativeSessionUsesContentAddressedModelId() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("content-addressed.gguf")
        try Data("GGUF-content-addressed".utf8).write(to: source)

        let engine = TestLlamaEngine()
        let model = LocalChatModel(
            modelDirectory: root.appendingPathComponent("models", isDirectory: true),
            engine: engine
        )
        try await model.importModel(from: source)
        let destination = try XCTUnwrap(model.modelURL)
        let fingerprint = try ModelArtifactFingerprint.compute(at: destination)

        await model.loadModel()
        let modelIDs = await engine.loadedModelIdentifiers()
        XCTAssertEqual(modelIDs, ["sha256-\(fingerprint.sha256)"])
        XCTAssertTrue(model.modelFingerprintSummary.contains(String(fingerprint.sha256.prefix(16))))
        XCTAssertEqual(model.trustStatus, "Unverified")
    }

    @MainActor
    func testFileMutationDuringNativeLoadUnloadsTheUnboundSession() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("mutating.gguf")
        try Data("GGUF-before-load".utf8).write(to: source)

        let engine = TestLlamaEngine(mutateModelFileOnLoad: true)
        let model = LocalChatModel(
            modelDirectory: root.appendingPathComponent("models", isDirectory: true),
            engine: engine
        )
        try await model.importModel(from: source)
        await model.loadModel()

        let loaded = await engine.loadedSessionIDs()
        let unloaded = await engine.unloadedSessionIDs()
        XCTAssertTrue(loaded.isEmpty)
        XCTAssertEqual(unloaded, ["test-session-1"])
        XCTAssertTrue(model.status.contains("changed while the native runtime was loading"))
        XCTAssertEqual(model.trustStatus, "Unverified")
    }

    @MainActor
    func testBusyGuardRejectsASecondQueuedModelLoad() async throws {
        let root = try makeTemporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try Data("GGUF-model".utf8).write(to: source)

        let engine = BlockingTestLlamaEngine()
        let model = LocalChatModel(
            modelDirectory: root.appendingPathComponent("models", isDirectory: true),
            engine: engine
        )
        try await model.importModel(from: source)

        let firstLoad = Task { await model.loadModel() }
        while !(await engine.hasStartedLoading()) { await Task.yield() }
        await model.loadModel()
        let callsBeforeRelease = await engine.loadCallCount()
        await engine.finishLoading()
        await firstLoad.value
        XCTAssertEqual(callsBeforeRelease, 1)
    }

    private func makeTemporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("PocketAILabTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}

private actor TestLlamaEngine: LlamaEngine {
    private var nextSession = 0
    private var loaded: [String] = []
    private var unloaded: [String] = []
    private var generated: [String] = []
    private var modelIdentifiers: [String] = []
    private var mutateModelFileOnLoad: Bool

    init(mutateModelFileOnLoad: Bool = false) {
        self.mutateModelFileOnLoad = mutateModelFileOnLoad
    }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        nextSession += 1
        modelIdentifiers.append(model.id)
        let session = RuntimeSession(id: "test-session-\(nextSession)", modelId: model.id)
        loaded.append(session.id)
        if mutateModelFileOnLoad {
            mutateModelFileOnLoad = false
            try Data("GGUF-mutated-during-load".utf8).write(to: URL(fileURLWithPath: model.path))
        }
        return session
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        generated.append(session.id)
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: "test output", isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async {}

    func unload(sessionId: String) async {
        unloaded.append(sessionId)
        loaded.removeAll { $0 == sessionId }
    }

    func loadedSessionIDs() -> [String] { loaded }
    func unloadedSessionIDs() -> [String] { unloaded }
    func generatedSessionIDs() -> [String] { generated }
    func loadedModelIdentifiers() -> [String] { modelIdentifiers }
    func loadCallCount() -> Int { nextSession }
}

private actor BlockingTestLlamaEngine: LlamaEngine {
    private var loadCalls = 0
    private var continuation: CheckedContinuation<Void, Never>?
    private var started = false

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        loadCalls += 1
        started = true
        await withCheckedContinuation { continuation = $0 }
        return RuntimeSession(id: "blocking-session", modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        AsyncThrowingStream { $0.finish() }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}

    func hasStartedLoading() -> Bool { started }
    func loadCallCount() -> Int { loadCalls }

    func finishLoading() {
        continuation?.resume()
        continuation = nil
    }
}

import XCTest
@testable import PocketAILab
import PocketLlamaEngine

final class PocketAILabTests: XCTestCase {
    func testUnavailableProbeNeverClaimsMetalReady() {
        let probe = LlamaCppMetalBackend.probe()
        if !probe.linked { XCTAssertFalse(probe.metalDeviceUsable) }
        if !probe.metalBackendRegistered { XCTAssertFalse(probe.metalDeviceUsable) }
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
        XCTAssertFalse(isAllowedWorkspaceURL(URL(string: "https:/workspace")!))
        XCTAssertFalse(isAllowedWorkspaceURL(URL(string: "http://workspace.example")!))
        XCTAssertFalse(isAllowedWorkspaceURL(URL(string: "https://user:password@workspace.example")!))
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

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        nextSession += 1
        let session = RuntimeSession(id: "test-session-\(nextSession)", modelId: model.id)
        loaded.append(session.id)
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

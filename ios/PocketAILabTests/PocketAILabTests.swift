import XCTest
@testable import PocketAILab
import PocketLlamaEngine

final class PocketAILabTests: XCTestCase {
    private func makeTemporaryRoot() throws -> URL {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        return root
    }

    @MainActor
    private func makeLocalChatModel(engine: any LlamaEngine, root: URL) -> LocalChatModel {
        let modelDirectory = root.appendingPathComponent("models", isDirectory: true)
        let catalogStore = LocalModelCatalogStore(
            fileURL: root.appendingPathComponent("ModelCatalog.json"),
            modelDirectory: modelDirectory
        )
        let conversationStore = LocalConversationStore(
            fileURL: root.appendingPathComponent("ConversationHistory.json")
        )
        let taskHistoryStore = LocalAgentTaskHistoryStore(
            fileURL: root.appendingPathComponent("AgentTaskHistory.json")
        )
        let composition = NativeRuntimeComposition(
            engine: engine,
            availableMemoryMB: { 4_096 }
        )
        return LocalChatModel(
            runtimeDependency: composition.dependency,
            engine: engine,
            modelDirectory: modelDirectory,
            conversationStore: conversationStore,
            agentTaskHistoryStore: taskHistoryStore,
            modelCatalogStore: catalogStore,
            availableMemoryMB: { 4_096 }
        )
    }

    @MainActor
    func testMultipleLocalChatConsumersShareOneAppScopedRuntimePool() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        let modelDirectory = root.appendingPathComponent("models", isDirectory: true)
        try validGGUFHeader().write(to: source)

        let engine = FingerprintTestEngine()
        let catalog = LocalModelCatalogStore(
            fileURL: root.appendingPathComponent("ModelCatalog.json"),
            modelDirectory: modelDirectory
        )
        let composition = NativeRuntimeComposition(
            engine: engine,
            availableMemoryMB: { 4_096 }
        )
        let first = LocalChatModel(
            runtimeDependency: composition.dependency,
            engine: engine,
            modelDirectory: modelDirectory,
            conversationStore: LocalConversationStore(
                fileURL: root.appendingPathComponent("first-history.json")
            ),
            agentTaskHistoryStore: LocalAgentTaskHistoryStore(
                fileURL: root.appendingPathComponent("first-tasks.json")
            ),
            modelCatalogStore: catalog
        )
        try await first.importModel(from: source)

        let second = LocalChatModel(
            runtimeDependency: composition.dependency,
            engine: engine,
            modelDirectory: modelDirectory,
            conversationStore: LocalConversationStore(
                fileURL: root.appendingPathComponent("second-history.json")
            ),
            agentTaskHistoryStore: LocalAgentTaskHistoryStore(
                fileURL: root.appendingPathComponent("second-tasks.json")
            ),
            modelCatalogStore: catalog
        )

        await first.loadModel()
        await second.loadModel()

        XCTAssertTrue(first.isModelLoaded)
        XCTAssertTrue(second.isModelLoaded)
        let loadCount = await engine.loadCount()
        XCTAssertEqual(loadCount, 1, "Both consumers must resolve through the same ModelPool.")

        await first.unloadModel()
        await second.unloadModel()
        let unloadedSessions = await engine.unloadedSessionIDs()
        XCTAssertEqual(unloadedSessions, ["fingerprint-session"])
    }

    @MainActor
    func testUnavailableAppRuntimeDoesNotCreatePerViewFallback() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = LocalChatModel(
            runtimeDependency: .unavailable("App-scoped runtime initialization failed closed."),
            engine: engine,
            modelDirectory: root.appendingPathComponent("models", isDirectory: true)
        )

        try await model.importModel(from: source)
        await model.loadModel()

        let loadCount = await engine.loadCount()
        XCTAssertEqual(loadCount, 0, "An unavailable shared runtime must not trigger a second per-view runtime.")
        XCTAssertFalse(model.isModelLoaded)
        XCTAssertTrue(model.status.contains("shared native inference runtime is unavailable"))
    }

    func testUnavailableProbeNeverClaimsMetalReady() {
        let probe = LlamaCppMetalBackend.probe()
        if !probe.linked { XCTAssertFalse(probe.metalDeviceUsable) }
        if !probe.metalBackendRegistered { XCTAssertFalse(probe.metalDeviceUsable) }
    }

    func testOnlyGGUFModelFilesAreAccepted() {
        XCTAssertEqual(URL(fileURLWithPath: "/tmp/model.gguf").pathExtension.lowercased(), "gguf")
        XCTAssertNotEqual(URL(fileURLWithPath: "/tmp/model.bin").pathExtension.lowercased(), "gguf")
        XCTAssertNotEqual(URL(fileURLWithPath: "/tmp/model.gguf.zip").pathExtension.lowercased(), "gguf")
    }


    func testStagedImporterPreservesLastKnownGoodModelOnInvalidHeader() throws {
        let root = try makeTemporaryRoot()
        let sourceDirectory = root.appendingPathComponent("source", isDirectory: true)
        let modelDirectory = root.appendingPathComponent("models", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let source = sourceDirectory.appendingPathComponent("model.gguf")
        let destination = modelDirectory.appendingPathComponent("model.gguf")
        let previous = validGGUFHeader()
        try previous.write(to: destination)
        try Data("NOT-GGUF".utf8).write(to: source)

        XCTAssertThrowsError(try LocalGGUFImporter.copy(source: source, into: modelDirectory)) { error in
            XCTAssertEqual(error as? LocalChatError, .invalidGGUFHeader)
        }
        XCTAssertEqual(try Data(contentsOf: destination), previous)
        let remaining = try FileManager.default.contentsOfDirectory(atPath: modelDirectory.path)
        XCTAssertEqual(remaining, ["model.gguf"])
    }

    func testStagedImporterRejectsTruncatedAndUnsupportedVersionHeaders() throws {
        let root = try makeTemporaryRoot()
        let modelDirectory = root.appendingPathComponent("models", isDirectory: true)
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let truncated = root.appendingPathComponent("truncated.gguf")
        try Data("GGUF".utf8).write(to: truncated)
        XCTAssertThrowsError(try LocalGGUFImporter.copy(source: truncated, into: modelDirectory)) { error in
            XCTAssertEqual(error as? LocalChatError, .invalidGGUFHeader)
        }

        let unsupported = root.appendingPathComponent("unsupported.gguf")
        try validGGUFHeader(version: 99).write(to: unsupported)
        XCTAssertThrowsError(try LocalGGUFImporter.copy(source: unsupported, into: modelDirectory)) { error in
            XCTAssertEqual(error as? LocalChatError, .invalidGGUFHeader)
        }
        XCTAssertFalse(FileManager.default.fileExists(atPath: modelDirectory.appendingPathComponent("truncated.gguf").path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: modelDirectory.appendingPathComponent("unsupported.gguf").path))
    }

    func testStagedImporterAtomicallyReplacesValidModelAndHandlesSamePath() throws {
        let root = try makeTemporaryRoot()
        let sourceDirectory = root.appendingPathComponent("source", isDirectory: true)
        let modelDirectory = root.appendingPathComponent("models", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let source = sourceDirectory.appendingPathComponent("model.gguf")
        let destination = modelDirectory.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        try validGGUFHeader(version: 2).write(to: destination)

        let imported = try LocalGGUFImporter.copy(source: source, into: modelDirectory)
        XCTAssertEqual(imported.url, destination)
        XCTAssertEqual(try Data(contentsOf: destination), validGGUFHeader())

        let samePath = try LocalGGUFImporter.copy(source: destination, into: modelDirectory)
        XCTAssertEqual(samePath.url, destination)
        XCTAssertEqual(try Data(contentsOf: destination), validGGUFHeader())
    }


    @MainActor
    func testLocalModelCatalogPersistsMultipleSameNamedImportsAndSelection() async throws {
        let root = try makeTemporaryRoot()
        let sourceA = root.appendingPathComponent("source-a", isDirectory: true)
        let sourceB = root.appendingPathComponent("source-b", isDirectory: true)
        let modelDirectory = root.appendingPathComponent("models", isDirectory: true)
        try FileManager.default.createDirectory(at: sourceA, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: sourceB, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: modelDirectory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let firstSource = sourceA.appendingPathComponent("model.gguf")
        let secondSource = sourceB.appendingPathComponent("model.gguf")
        try validGGUFHeader(version: 2).write(to: firstSource)
        try validGGUFHeader(version: 3).write(to: secondSource)
        let catalog = LocalModelCatalogStore(
            fileURL: root.appendingPathComponent("catalog.json"),
            modelDirectory: modelDirectory
        )
        let model = LocalChatModel(
            engine: FingerprintTestEngine(),
            modelDirectory: modelDirectory,
            modelCatalogStore: catalog
        )

        try await model.importModel(from: firstSource)
        let firstID = try XCTUnwrap(model.selectedModelID)
        let firstURL = try XCTUnwrap(model.modelURL)
        try await model.importModel(from: secondSource)

        XCTAssertEqual(model.availableModels.count, 2)
        XCTAssertNotEqual(firstURL, model.modelURL)
        XCTAssertTrue(FileManager.default.fileExists(atPath: firstURL.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: try XCTUnwrap(model.modelURL).path))

        model.selectModel(firstID)
        XCTAssertEqual(model.selectedModelID, firstID)
        XCTAssertEqual(model.modelURL, firstURL)

        let restoredEngine = FingerprintTestEngine()
        let restoredComposition = NativeRuntimeComposition(
            engine: restoredEngine,
            availableMemoryMB: { 4_096 }
        )
        let restored = LocalChatModel(
            runtimeDependency: restoredComposition.dependency,
            engine: restoredEngine,
            modelDirectory: modelDirectory,
            modelCatalogStore: catalog
        )
        XCTAssertEqual(restored.availableModels.count, 2)
        XCTAssertEqual(restored.selectedModelID, firstID)
        XCTAssertEqual(restored.modelURL, firstURL)
        XCTAssertFalse(restored.isModelLoaded, "Catalog selection must not fabricate a loaded runtime session.")
    }

    // Minimum 24-byte GGUF header: magic, version, tensor count, and metadata count.
    private func validGGUFHeader(version: UInt32 = 3) -> Data {
        var data = Data("GGUF".utf8)
        data.append(UInt8(truncatingIfNeeded: version))
        data.append(UInt8(truncatingIfNeeded: version >> 8))
        data.append(UInt8(truncatingIfNeeded: version >> 16))
        data.append(UInt8(truncatingIfNeeded: version >> 24))
        data.append(contentsOf: Array(repeating: UInt8(0), count: 16))
        return data
    }

    @MainActor
    func testUnreadableArtifactDoesNotOrphanExistingModelLease() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = makeLocalChatModel(engine: engine, root: root)
        try await model.importModel(from: source)

        await model.loadModel()
        XCTAssertTrue(model.isModelLoaded)

        try FileManager.default.removeItem(at: try XCTUnwrap(model.modelURL))
        await model.loadModel()

        XCTAssertTrue(model.isModelLoaded, "A preflight read error must not discard the active ModelPool lease.")
        XCTAssertTrue(model.status.contains("Model load failed closed"))

        await model.unloadModel()
        XCTAssertFalse(model.isModelLoaded, "The retained lease must remain releasable.")
        let unloaded = await engine.unloadedSessionIDs()
        XCTAssertEqual(unloaded, ["fingerprint-session"])
    }

    @MainActor
    func testChatCarriesBoundedPriorTurnsIntoNextGeneration() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = makeLocalChatModel(engine: engine, root: root)
        try await model.importModel(from: source)
        await model.loadModel()

        await model.send("What is a model lease?")
        await model.send("Why does it matter during cancellation?")

        let prompts = await engine.recordedPrompts()
        XCTAssertEqual(prompts.count, 2)
        XCTAssertTrue(prompts[0].contains("You: What is a model lease?"))
        XCTAssertTrue(prompts[1].contains("You: What is a model lease?"))
        XCTAssertTrue(prompts[1].contains("Pocket AI: test"))
        XCTAssertTrue(prompts[1].contains("You: Why does it matter during cancellation?"))
        XCTAssertLessThanOrEqual(prompts[1].utf8.count, 1_500)
        XCTAssertTrue(model.isModelLoaded)
        await model.unloadModel()
    }

    @MainActor
    func testChatPromptIsBoundedForOversizedCurrentMessage() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = makeLocalChatModel(engine: engine, root: root)
        try await model.importModel(from: source)
        await model.loadModel()

        await model.send(String(repeating: "x", count: 9_000))

        let prompts = await engine.recordedPrompts()
        XCTAssertEqual(prompts.count, 1)
        XCTAssertLessThanOrEqual(prompts[0].utf8.count, 1_500)
        XCTAssertTrue(prompts[0].contains("Pocket AI:"))
        await model.unloadModel()
    }

    @MainActor
    func testChatContextExcludesAgentTeamTaskAndRoleMessages() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = makeLocalChatModel(engine: engine, root: root)
        try await model.importModel(from: source)
        model.updateRoutingCapabilities(
            try XCTUnwrap(model.selectedModelID),
            from: "planning, reasoning, analysis, engineering, security-review, critique, validation, documentation"
        )
        await model.loadModel()

        await model.runDefaultAgentTeam("Sensitive Agent Team-only objective")
        await model.send("Continue ordinary chat")

        let prompts = await engine.recordedPrompts()
        XCTAssertEqual(prompts.count, 9)
        let chatPrompt = try XCTUnwrap(prompts.last)
        XCTAssertTrue(chatPrompt.contains("You: Continue ordinary chat"))
        XCTAssertFalse(chatPrompt.contains("Sensitive Agent Team-only objective"))
        XCTAssertFalse(chatPrompt.contains("Agent Team ·"))
        await model.unloadModel()
    }

    @MainActor
    func testDefaultAgentTeamRoutesEightRolesThroughConfiguredLocalProfile() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = makeLocalChatModel(engine: engine, root: root)
        try await model.importModel(from: source)
        model.updateRoutingCapabilities(
            try XCTUnwrap(model.selectedModelID),
            from: "planning, reasoning, analysis, engineering, security-review, critique, validation, documentation"
        )
        await model.loadModel()
        XCTAssertTrue(model.isModelLoaded)

        await model.runDefaultAgentTeam("Review the shared native inference architecture")

        let roleMessages = model.messages.filter { $0.role.hasPrefix("Agent Team ·") }
        XCTAssertEqual(roleMessages.count, 8)
        XCTAssertTrue(roleMessages[0].role.contains("director"))
        XCTAssertTrue(roleMessages[1].role.contains("reasoner"))
        XCTAssertTrue(roleMessages[5].role.contains("critic"))
        XCTAssertTrue(roleMessages[6].role.contains("validator"))
        XCTAssertTrue(roleMessages[7].role.contains("archivist"))
        XCTAssertTrue(model.status.contains("8 sequential logical roles"))
        XCTAssertTrue(model.isModelLoaded, "Agent Team must retain the shared model lease.")
    }

    @MainActor
    func testAgentTeamCanReplaceCoreRoleWithExplicitSpecialistTemplate() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = makeLocalChatModel(engine: engine, root: root)
        try await model.importModel(from: source)
        model.updateRoutingCapabilities(
            try XCTUnwrap(model.selectedModelID),
            from: "planning, reasoning, analysis, engineering, security-review, critique, validation, documentation, swift, ios"
        )
        await model.loadModel()

        let plan = ["director", "reasoner", "researcher", "swift-ios", "security-analyst", "critic", "validator", "archivist"]
        await model.runDefaultAgentTeam("Review the Swift runtime", agentIDs: plan)

        let roleMessages = model.messages.filter { $0.role.hasPrefix("Agent Team ·") }
        XCTAssertEqual(roleMessages.count, 8)
        XCTAssertTrue(roleMessages[3].role.contains("swift-ios"))
        XCTAssertTrue(model.status.contains("8 sequential logical roles"))
        await model.unloadModel()
    }

    @MainActor
    func testAgentTeamMissingSpecialistRouteFailsBeforeModelLoad() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = makeLocalChatModel(engine: engine, root: root)
        try await model.importModel(from: source)

        await model.runDefaultAgentTeam("Attempt a specialist run without configured labels")

        XCTAssertTrue(model.status.contains("did not complete") || model.status.contains("failed"))
        XCTAssertFalse(model.isModelLoaded)
        let loadedModelIDs = await engine.loadedModelIDs()
        let prompts = await engine.recordedPrompts()
        XCTAssertEqual(loadedModelIDs, [])
        XCTAssertEqual(prompts.count, 0)
    }

    @MainActor
    func testNativeSessionUsesContentAddressedModelId() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = makeLocalChatModel(engine: engine, root: root)
        try await model.importModel(from: source)
        let importedURL = try XCTUnwrap(model.modelURL)
        let fingerprint = try ModelArtifactFingerprint.compute(at: importedURL)

        await model.loadModel()

        let identifiers = await engine.loadedModelIDs()
        XCTAssertEqual(identifiers, ["sha256-\(fingerprint.sha256)"])
        XCTAssertTrue(model.modelFingerprintSummary.contains(String(fingerprint.sha256.prefix(16))))
        XCTAssertEqual(model.trustStatus, "Unverified")
        XCTAssertTrue(model.isModelLoaded)
    }

    @MainActor
    func testChangedArtifactIsRejectedBeforeNativeLoad() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = makeLocalChatModel(engine: engine, root: root)
        try await model.importModel(from: source)
        try Data("tampered artifact".utf8).write(to: try XCTUnwrap(model.modelURL))

        await model.loadModel()

        let loadCount = await engine.loadCount()
        XCTAssertEqual(loadCount, 0)
        XCTAssertTrue(model.status.contains("changed after import"))
        XCTAssertFalse(model.isModelLoaded)
    }

    @MainActor
    func testArtifactMutationDuringNativeLoadUnloadsUnboundSession() async throws {
        let root = try makeTemporaryRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine(mutateOnLoad: true)
        let model = makeLocalChatModel(engine: engine, root: root)
        try await model.importModel(from: source)

        await model.loadModel()

        XCTAssertFalse(model.isModelLoaded)
        XCTAssertTrue(model.status.contains("changed while the native runtime was loading"))
        let unloaded = await engine.unloadedSessionIDs()
        XCTAssertEqual(unloaded, ["fingerprint-session"])
        XCTAssertEqual(model.trustStatus, "Unverified")
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

    @MainActor
    func testWorkspaceWebViewReloadsOnlyForExplicitOpenRequests() {
        let coordinator = PrivateWorkspaceWebView.Coordinator(
            trustedURL: URL(string: "https://workspace.example")!,
            runtimeDependency: .createForTesting
        )
        let firstRequest = UUID()
        XCTAssertTrue(coordinator.shouldLoad(firstRequest))
        XCTAssertFalse(coordinator.shouldLoad(firstRequest))
        XCTAssertTrue(coordinator.shouldLoad(UUID()))
    }

    func testRuntimeTrustRemainsUnverifiedUntilTrustedLeaseIntegrationExists() {
        XCTAssertEqual(RuntimeTrustPresentation.stateLabel, "Unverified")
        XCTAssertFalse(RuntimeTrustPresentation.isVerified)
        XCTAssertTrue(RuntimeTrustPresentation.detail.contains("server-issued runtime lease"))
        XCTAssertTrue(RuntimeTrustPresentation.statusMessage(after: "Model loaded").contains("Runtime trust remains unverified"))
    }
}

private actor FingerprintTestEngine: LlamaEngine {
    private var identifiers: [String] = []
    private var unloaded: [String] = []
    private var loads = 0
    private var prompts: [String] = []
    private var mutateOnLoad: Bool

    init(mutateOnLoad: Bool = false) {
        self.mutateOnLoad = mutateOnLoad
    }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        loads += 1
        identifiers.append(model.id)
        let session = RuntimeSession(id: "fingerprint-session", modelId: model.id)
        if mutateOnLoad {
            mutateOnLoad = false
            try Data("GGUF-mutated-after-load".utf8).write(to: URL(fileURLWithPath: model.path))
        }
        return session
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        prompts.append(request.prompt)
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: "test", isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async { unloaded.append(sessionId) }
    func loadedModelIDs() -> [String] { identifiers }
    func unloadedSessionIDs() -> [String] { unloaded }
    func loadCount() -> Int { loads }
    func recordedPrompts() -> [String] { prompts }
}

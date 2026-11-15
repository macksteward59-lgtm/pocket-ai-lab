import XCTest
@testable import PocketAILab
import PocketLlamaEngine

final class PocketAILabTests: XCTestCase {
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
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
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
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
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
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
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
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = LocalChatModel(engine: engine, modelDirectory: root.appendingPathComponent("models", isDirectory: true))
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
    func testNativeSessionUsesContentAddressedModelId() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = LocalChatModel(engine: engine, modelDirectory: root.appendingPathComponent("models", isDirectory: true))
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
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine()
        let model = LocalChatModel(engine: engine, modelDirectory: root.appendingPathComponent("models", isDirectory: true))
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
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("model.gguf")
        try validGGUFHeader().write(to: source)
        let engine = FingerprintTestEngine(mutateOnLoad: true)
        let model = LocalChatModel(engine: engine, modelDirectory: root.appendingPathComponent("models", isDirectory: true))
        try await model.importModel(from: source)

        await model.loadModel()

        XCTAssertFalse(model.isModelLoaded)
        XCTAssertTrue(model.status.contains("changed while the native runtime was loading"))
        let unloaded = await engine.unloadedSessionIDs()
        XCTAssertEqual(unloaded, ["fingerprint-session"])
        XCTAssertEqual(model.trustStatus, "Unverified")
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
        AsyncThrowingStream { continuation in
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
}

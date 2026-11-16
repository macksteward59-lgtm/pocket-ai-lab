import XCTest
@testable import PocketAILab

final class LocalModelCatalogTests: XCTestCase {
    func testRegisterAndSelectMultipleContentAddressedModels() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let models = root.appendingPathComponent("Models", isDirectory: true)
        let support = root.appendingPathComponent("Support", isDirectory: true)
        try FileManager.default.createDirectory(at: models, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let firstURL = models.appendingPathComponent("small-a.gguf")
        let secondURL = models.appendingPathComponent("small-b.gguf")
        try Data("first model bytes".utf8).write(to: firstURL)
        try Data("second model bytes".utf8).write(to: secondURL)
        let store = LocalModelCatalogStore(
            fileURL: support.appendingPathComponent("catalog.json"),
            modelDirectory: models
        )
        let first = ImportedModelArtifact(url: firstURL, fingerprint: try ModelArtifactFingerprint.compute(at: firstURL))
        let second = ImportedModelArtifact(url: secondURL, fingerprint: try ModelArtifactFingerprint.compute(at: secondURL))

        let afterFirst = try store.register(first, displayName: "Small model")
        let afterSecond = try store.register(second, displayName: "Small model")

        XCTAssertEqual(afterFirst.entries.count, 1)
        XCTAssertEqual(afterSecond.entries.count, 2)
        XCTAssertEqual(afterSecond.selectedModelID, "sha256-\(second.fingerprint.sha256)")
        XCTAssertEqual(afterSecond.entries.map(\.id).count, 2)
        XCTAssertEqual(try store.resolve(try XCTUnwrap(afterSecond.entries.first)).lastPathComponent, "small-b.gguf")
    }

    func testSelectionPersistsAndCanBeCleared() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let models = root.appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: models, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = models.appendingPathComponent("model.gguf")
        try Data("model bytes".utf8).write(to: file)
        let catalogURL = root.appendingPathComponent("catalog.json")
        let store = LocalModelCatalogStore(fileURL: catalogURL, modelDirectory: models)
        let artifact = ImportedModelArtifact(url: file, fingerprint: try ModelArtifactFingerprint.compute(at: file))
        let registered = try store.register(artifact, displayName: "Model")

        let selected = try store.select(registered.entries[0].id)
        XCTAssertEqual(selected.selectedModelID, registered.entries[0].id)

        let reloaded = try LocalModelCatalogStore(fileURL: catalogURL, modelDirectory: models).load()
        XCTAssertEqual(reloaded.selectedModelID, registered.entries[0].id)
        XCTAssertNil(try store.select(nil).selectedModelID)
    }

    func testDuplicateContentDoesNotCreateDuplicateCatalogEntries() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let models = root.appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: models, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = models.appendingPathComponent("model.gguf")
        try Data("identical model".utf8).write(to: file)
        let fingerprint = try ModelArtifactFingerprint.compute(at: file)
        let store = LocalModelCatalogStore(fileURL: root.appendingPathComponent("catalog.json"), modelDirectory: models)

        _ = try store.register(ImportedModelArtifact(url: file, fingerprint: fingerprint), displayName: "Model")
        let updated = try store.register(ImportedModelArtifact(url: file, fingerprint: fingerprint), displayName: "Renamed")

        XCTAssertEqual(updated.entries.count, 1)
        XCTAssertEqual(updated.entries[0].name, "Renamed")
    }

    func testRegistrationRejectsFilesOutsidePrivateModelDirectory() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let models = root.appendingPathComponent("Models", isDirectory: true)
        let outside = root.appendingPathComponent("outside.gguf")
        try FileManager.default.createDirectory(at: models, withIntermediateDirectories: true)
        try Data("outside model".utf8).write(to: outside)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalModelCatalogStore(fileURL: root.appendingPathComponent("catalog.json"), modelDirectory: models)
        let artifact = ImportedModelArtifact(url: outside, fingerprint: try ModelArtifactFingerprint.compute(at: outside))

        XCTAssertThrowsError(try store.register(artifact, displayName: "Outside")) { error in
            XCTAssertEqual(error as? LocalModelCatalogStore.StoreError, .unsafeModelPath)
        }
    }

    func testSelectedModelMustExistAndRemainInsideCatalogDirectory() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let models = root.appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: models, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = models.appendingPathComponent("model.gguf")
        try Data("model bytes".utf8).write(to: file)
        let store = LocalModelCatalogStore(fileURL: root.appendingPathComponent("catalog.json"), modelDirectory: models)
        let artifact = ImportedModelArtifact(url: file, fingerprint: try ModelArtifactFingerprint.compute(at: file))
        let entry = try XCTUnwrap(store.register(artifact, displayName: "Model").entries.first)
        try FileManager.default.removeItem(at: file)

        XCTAssertThrowsError(try store.select(entry.id)) { error in
            XCTAssertEqual(error as? LocalModelCatalogStore.StoreError, .modelFileMissing)
        }
    }

    func testUnknownCatalogVersionFailsClosedAndPreservesArchive() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let models = root.appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: models, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("catalog.json")
        let original = Data("{\"version\":99,\"savedAt\":\"2026-01-01T00:00:00Z\",\"selectedModelID\":null,\"entries\":[]}".utf8)
        try original.write(to: file)
        let store = LocalModelCatalogStore(fileURL: file, modelDirectory: models)

        XCTAssertThrowsError(try store.load()) { error in
            XCTAssertEqual(error as? LocalModelCatalogStore.StoreError, .unsupportedVersion)
        }
        XCTAssertEqual(try Data(contentsOf: file), original)
    }

    func testUnknownSelectedModelReferenceFailsClosedAndPreservesArchive() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let models = root.appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: models, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("catalog.json")
        let original = Data("{\"version\":1,\"savedAt\":\"2026-01-01T00:00:00Z\",\"selectedModelID\":\"sha256-missing\",\"entries\":[]}".utf8)
        try original.write(to: file)
        let store = LocalModelCatalogStore(fileURL: file, modelDirectory: models)

        XCTAssertThrowsError(try store.load()) { error in
            XCTAssertEqual(error as? LocalModelCatalogStore.StoreError, .invalidEntry)
        }
        XCTAssertEqual(try Data(contentsOf: file), original)
    }

    func testOperatorRoutingCapabilitiesPersistAndNormalize() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let models = root.appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: models, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = models.appendingPathComponent("model.gguf")
        try Data("model bytes".utf8).write(to: file)
        let catalogURL = root.appendingPathComponent("catalog.json")
        let store = LocalModelCatalogStore(fileURL: catalogURL, modelDirectory: models)
        let artifact = ImportedModelArtifact(url: file, fingerprint: try ModelArtifactFingerprint.compute(at: file))
        let registered = try store.register(artifact, displayName: "Model")
        let modelID = try XCTUnwrap(registered.selectedModelID)

        let updated = try store.updateCapabilities(
            for: modelID,
            capabilities: [" Reasoning ", "analysis", "reasoning", ""]
        )

        XCTAssertEqual(updated.entries.first?.capabilities, ["analysis", "reasoning"])
        XCTAssertEqual(try LocalModelCatalogStore(fileURL: catalogURL, modelDirectory: models).load().entries.first?.capabilities,
                       ["analysis", "reasoning"])

        let cleared = try store.updateCapabilities(for: modelID, capabilities: [])
        XCTAssertEqual(cleared.entries.first?.capabilities, [])
        XCTAssertEqual(try LocalModelCatalogStore(fileURL: catalogURL, modelDirectory: models).load().entries.first?.capabilities, [])
    }


}

import Foundation
import XCTest
@testable import PocketLlamaEngine

final class GGUFMetadataTests: XCTestCase {
    func testInspectorRejectsMissingArtifact() throws {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("missing-\(UUID().uuidString).gguf")
        XCTAssertThrowsError(try GGUFMetadataInspector.inspect(at: url))
    }

    func testInspectorRejectsDirectoryInsteadOfGGUFFile() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("not-a-model-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertThrowsError(try GGUFMetadataInspector.inspect(at: directory))
    }

    func testMetadataModelDoesNotInventOptionalCapabilities() {
        let metadata = GGUFModelMetadata(
            version: 3,
            architecture: "llama",
            modelName: nil,
            tokenizerModel: nil,
            trainingContextLength: nil,
            fileType: nil,
            parameterCount: nil,
            fileSizeBytes: 1,
            metadataKeyCount: 1
        )
        XCTAssertNil(metadata.trainingContextLength)
        XCTAssertNil(metadata.fileType)
        XCTAssertNil(metadata.parameterCount)
        XCTAssertNil(metadata.modelName)
        XCTAssertNil(metadata.tokenizerModel)
    }
}

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


    func testPinnedSmokeGGUFMetadataWhenConfigured() throws {
        guard let path = SmokePath.path else {
            XCTAssertFalse(SmokePath.required, "CI marked the smoke GGUF required but did not configure its path.")
            return
        }
        let url = URL(fileURLWithPath: path)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        let metadata = try GGUFMetadataInspector.inspect(at: url)
        XCTAssertGreaterThanOrEqual(metadata.version, 2)
        XCTAssertLessThanOrEqual(metadata.version, 3)
        XCTAssertFalse(metadata.architecture.isEmpty)
        XCTAssertGreaterThan(metadata.metadataKeyCount, 0)
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        XCTAssertEqual(metadata.fileSizeBytes, (attributes[.size] as? NSNumber)?.uint64Value)
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

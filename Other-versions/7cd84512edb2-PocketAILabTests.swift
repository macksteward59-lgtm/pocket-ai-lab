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
        XCTAssertEqual(imported, destination)
        XCTAssertEqual(try Data(contentsOf: destination), validGGUFHeader())

        let samePath = try LocalGGUFImporter.copy(source: destination, into: modelDirectory)
        XCTAssertEqual(samePath, destination)
        XCTAssertEqual(try Data(contentsOf: destination), validGGUFHeader())
    }

    private func validGGUFHeader(version: UInt32 = 3) -> Data {
        var data = Data("GGUF".utf8)
        data.append(UInt8(truncatingIfNeeded: version))
        data.append(UInt8(truncatingIfNeeded: version >> 8))
        data.append(UInt8(truncatingIfNeeded: version >> 16))
        data.append(UInt8(truncatingIfNeeded: version >> 24))
        data.append(contentsOf: Array(repeating: UInt8(0), count: 16))
        return data
    }

    func testRuntimeTrustRemainsUnverifiedUntilTrustedLeaseIntegrationExists() {
        XCTAssertEqual(RuntimeTrustPresentation.stateLabel, "Unverified")
        XCTAssertFalse(RuntimeTrustPresentation.isVerified)
        XCTAssertTrue(RuntimeTrustPresentation.detail.contains("server-issued runtime lease"))
        XCTAssertTrue(RuntimeTrustPresentation.statusMessage(after: "Model loaded").contains("Runtime trust remains unverified"))
    }
}

import XCTest
import CryptoKit
@testable import PocketAILab

private struct FixedNativeMemoryKeyProvider: NativeMemoryKeyProvider {
    let material: Data?
    let mayCreate: Bool

    func existingKey() throws -> SymmetricKey? {
        guard let material else { return nil }
        return SymmetricKey(data: material)
    }

    func getOrCreateKey() throws -> SymmetricKey {
        guard mayCreate else { throw NativeMemoryVaultError.keyUnavailable }
        return SymmetricKey(data: material ?? Data(repeating: 7, count: 32))
    }
}

final class NativeMemoryStoreTests: XCTestCase {
    private func makeDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func testExplicitInsertPersistsEncryptedMemoryWithProvenance() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("memory.enc")
        let key = Data(repeating: 3, count: 32)
        let store = NativeMemoryStore(fileURL: file, keyProvider: FixedNativeMemoryKeyProvider(material: key, mayCreate: true))

        let id = try await store.insert(layer: .episodic, content: "Remember the architecture decision.", agentId: "user", taskId: "task-1", sourceRefs: ["chat:42"])
        let loaded = try await store.load()

        XCTAssertEqual(loaded.count, 1)
        XCTAssertEqual(loaded[0].id, id)
        XCTAssertEqual(loaded[0].content, "Remember the architecture decision.")
        XCTAssertEqual(loaded[0].provenance.agentId, "user")
        XCTAssertEqual(loaded[0].provenance.taskId, "task-1")
        XCTAssertEqual(loaded[0].provenance.sourceRefs, ["chat:42"])
        XCTAssertFalse(loaded[0].provenance.verified)
        let bytes = try Data(contentsOf: file)
        XCTAssertTrue(bytes.starts(with: Data("PALMEM01".utf8)))
        XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("Remember the architecture decision."))
    }

    func testTamperedCiphertextFailsClosed() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("memory.enc")
        let provider = FixedNativeMemoryKeyProvider(material: Data(repeating: 4, count: 32), mayCreate: true)
        let store = NativeMemoryStore(fileURL: file, keyProvider: provider)
        _ = try await store.insert(layer: .semantic, content: "A verified fact is still only memory.", agentId: "user")

        var bytes = try Data(contentsOf: file)
        bytes[bytes.count - 1] ^= 0x01
        try bytes.write(to: file, options: .atomic)

        do {
            _ = try await store.load()
            XCTFail("Tampered ciphertext must not be accepted.")
        } catch {
            XCTAssertEqual(error as? NativeMemoryVaultError, .integrityFailure)
        }
    }

    func testMissingKeyDoesNotSilentlyCreateReplacementForExistingVault() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("memory.enc")
        let original = NativeMemoryStore(
            fileURL: file,
            keyProvider: FixedNativeMemoryKeyProvider(material: Data(repeating: 5, count: 32), mayCreate: true)
        )
        _ = try await original.insert(layer: .working, content: "Keep this private.", agentId: "user")

        let missingKey = NativeMemoryStore(
            fileURL: file,
            keyProvider: FixedNativeMemoryKeyProvider(material: nil, mayCreate: false)
        )
        do {
            _ = try await missingKey.load()
            XCTFail("Existing vault must not be opened or overwritten without its original key.")
        } catch {
            XCTAssertEqual(error as? NativeMemoryVaultError, .keyUnavailable)
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))
    }

    func testUpdateAndDeleteAreExplicitAndEditsRemainUnverified() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = NativeMemoryStore(
            fileURL: directory.appendingPathComponent("memory.enc"),
            keyProvider: FixedNativeMemoryKeyProvider(material: Data(repeating: 6, count: 32), mayCreate: true)
        )
        let id = try await store.insert(layer: .procedural, content: "Initial note", agentId: "user")
        let updated = try await store.update(id: id, content: "Edited note", sourceRefs: ["manual:1"])
        XCTAssertTrue(updated)
        let edited = try await store.load()
        XCTAssertEqual(edited.first?.content, "Edited note")
        XCTAssertEqual(edited.first?.provenance.sourceRefs, ["manual:1"])
        XCTAssertFalse(edited.first?.provenance.verified ?? true)
        let deleted = try await store.delete(id: id)
        let afterDelete = try await store.load()
        XCTAssertTrue(deleted)
        XCTAssertTrue(afterDelete.isEmpty)
    }

    func testEmptyReadDoesNotCreateKeyOrVault() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("memory.enc")
        let store = NativeMemoryStore(
            fileURL: file,
            keyProvider: FixedNativeMemoryKeyProvider(material: nil, mayCreate: false)
        )
        let entries = try await store.load()
        XCTAssertTrue(entries.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }
}

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

    func testReopenedVaultKeepsTheSameEditedNoteAndBothReferenceValues() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("memory.enc")
        let provider = FixedNativeMemoryKeyProvider(material: Data(repeating: 5, count: 32), mayCreate: true)
        let store = NativeMemoryStore(fileURL: url, keyProvider: provider)
        let references = ["Chapter 1, Table 2", "Chapter 3"]
        let id = try await store.insert(layer: .working, content: "First draft", taskId: "review-1", sourceRefs: references)
        let updated = try await store.update(id: id, content: "Saved revision")
        XCTAssertTrue(updated)
        let reopened = NativeMemoryStore(fileURL: url, keyProvider: provider)
        let entries = try await reopened.load()
        XCTAssertEqual(entries.count, 1)
        let note = try XCTUnwrap(entries.first)
        XCTAssertEqual(note.id, id)
        XCTAssertEqual(note.content, "Saved revision")
        XCTAssertEqual(note.provenance.sourceRefs, references)
        XCTAssertEqual(note.provenance.taskId, "review-1")
        XCTAssertFalse(note.provenance.verified)
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

extension NativeMemoryStoreTests {
    func testCitedAnswerCorrectionSurvivesReplayAndRejectsStaleChanges() async throws {
        let directory = try makeDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("vault")
        let key = FixedNativeMemoryKeyProvider(material: Data(repeating: 8, count: 32), mayCreate: true)
        let store = NativeMemoryStore(fileURL: file, keyProvider: key)
        let url = try XCTUnwrap(Bundle.main.url(forResource: "SourceAnswerExample", withExtension: "json"))
        let bytes = try Data(contentsOf: url)
        let sources = try ProjectPassages.bundled()
        let draft = try SourceAnswerDraft.imported(bytes, from: sources)
        let first = try await store.retainSourceAnswer(draft)
        let updated = try await store.correctSourceAnswer(id: first.id, expectedRevision: 0, excerpt: "00:00 UTC")
        XCTAssertEqual(updated.content, "00:00 UTC")
        XCTAssertFalse(updated.provenance.verified)
        XCTAssertEqual(updated.sourceAnswer?.draft.excerpt, draft.excerpt)
        let reopened = NativeMemoryStore(fileURL: file, keyProvider: key)
        let replay = try await reopened.retainSourceAnswer(draft)
        XCTAssertEqual(replay, updated)
        do {
            _ = try await reopened.correctSourceAnswer(id: first.id, expectedRevision: 0, excerpt: "10,000 neurons")
            XCTFail("Stale correction accepted")
        } catch SourceAnswerError.stale {}
        do {
            _ = try await reopened.correctSourceAnswer(id: first.id, expectedRevision: 1, excerpt: "an invented claim")
            XCTFail("Unsupported excerpt accepted")
        } catch SourceAnswerError.invalidQuote {}
        var packet = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        packet["question"] = "A different question?"
        let other = try SourceAnswerDraft.imported(JSONSerialization.data(withJSONObject: packet), from: sources)
        do {
            _ = try await reopened.retainSourceAnswer(other)
            XCTFail("Request identity reused for a different question")
        } catch SourceAnswerError.conflict {}
        packet["sourceURL"] = "https://example.org/replaced"
        XCTAssertThrowsError(try SourceAnswerDraft.imported(JSONSerialization.data(withJSONObject: packet), from: sources))
        let final = try await reopened.load()
        XCTAssertEqual(final, [updated])
    }
}

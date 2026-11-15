import XCTest
@testable import PocketAILab

final class LocalConversationStoreTests: XCTestCase {
    func testArchiveRoundTripsMessagesAndStableIdentifiers() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("history.json")
        let store = LocalConversationStore(fileURL: file)
        let message = ChatLine(role: "You", text: "Remember this locally")

        try store.save([message])

        let restored = try store.load()
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(restored[0].id, message.id)
        XCTAssertEqual(restored[0].role, message.role)
        XCTAssertEqual(restored[0].text, message.text)
    }

    func testArchiveBoundsMessageCountAndPerMessageBytes() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalConversationStore(fileURL: root.appendingPathComponent("history.json"))
        let messages = (0..<(LocalConversationStore.maximumMessages + 10)).map {
            ChatLine(role: "You", text: "message-\($0)")
        } + [ChatLine(role: "You", text: String(repeating: "x", count: LocalConversationStore.maximumMessageBytes + 100))]

        try store.save(messages)

        let restored = try store.load()
        XCTAssertLessThanOrEqual(restored.count, LocalConversationStore.maximumMessages)
        XCTAssertTrue(restored.allSatisfy { $0.text.utf8.count <= LocalConversationStore.maximumMessageBytes })
        XCTAssertTrue(restored.last?.text.hasSuffix("…[older text clipped]") == true)
    }

    func testArchiveExpiresMessagesOutsideRetentionWindow() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixedNow = Date(timeIntervalSince1970: 2_000_000_000)
        let store = LocalConversationStore(fileURL: root.appendingPathComponent("history.json"), now: { fixedNow })
        let old = ChatLine(role: "You", text: "expired", timestamp: fixedNow.addingTimeInterval(-LocalConversationStore.retentionInterval - 1))
        let fresh = ChatLine(role: "You", text: "fresh", timestamp: fixedNow)

        try store.save([old, fresh])

        XCTAssertEqual(try store.load().map(\.text), ["fresh"])
    }

    func testClearRemovesTheArchive() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("history.json")
        let store = LocalConversationStore(fileURL: file)
        try store.save([ChatLine(role: "You", text: "private")])
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))

        try store.clear()

        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertTrue(try store.load().isEmpty)
    }

    func testUnsupportedArchiveVersionFailsClosedAndPreservesFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("history.json")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let original = Data("{\"version\":99,\"savedAt\":\"2026-01-01T00:00:00Z\",\"messages\":[]}".utf8)
        try original.write(to: file)
        let store = LocalConversationStore(fileURL: file)

        XCTAssertThrowsError(try store.load()) { error in
            XCTAssertEqual(error as? LocalConversationStore.StoreError, .unsupportedVersion)
        }
        XCTAssertEqual(try Data(contentsOf: file), original)
    }
}

import XCTest
@testable import PocketAILab

final class LocalAgentTaskHistoryStoreTests: XCTestCase {
    func testTaskLifecyclePersistsRoleResultsAndFinalResponse() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalAgentTaskHistoryStore(fileURL: root.appendingPathComponent("tasks.json"))
        let role = AgentTaskRoleResult(
            id: "message-1",
            role: "reasoner",
            sequence: 0,
            text: "Analyze dependencies",
            createdAt: Date()
        )

        try store.begin(id: "task-1", objective: "Review architecture")
        try store.complete(id: "task-1", roleResults: [role], finalResponse: "Review complete")

        let restored = try store.load()
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(restored[0].id, "task-1")
        XCTAssertEqual(restored[0].status, .completed)
        XCTAssertEqual(restored[0].roleResults, [role])
        XCTAssertEqual(restored[0].finalResponse, "Review complete")
        XCTAssertNil(restored[0].failureSummary)
    }

    func testRunningTaskIsMarkedInterruptedOnRecoveryAndNeverResumed() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("tasks.json")
        let store = LocalAgentTaskHistoryStore(fileURL: file)

        try store.begin(id: "task-2", objective: "Interrupted work")
        let recovered = try store.load()

        XCTAssertEqual(recovered.first?.status, .interrupted)
        XCTAssertTrue(recovered.first?.failureSummary?.contains("not resumed") == true)
        XCTAssertThrowsError(try store.complete(id: "task-2", roleResults: [], finalResponse: "unexpected")) { error in
            XCTAssertEqual(error as? LocalAgentTaskHistoryStore.StoreError, .invalidTransition)
        }
        XCTAssertEqual(try store.load().first?.status, .interrupted)
    }

    func testFailedTaskCannotBeCompletedLater() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalAgentTaskHistoryStore(fileURL: root.appendingPathComponent("tasks.json"))

        try store.begin(id: "task-3", objective: "Failing work")
        try store.fail(id: "task-3", summary: "Inference failed")

        XCTAssertEqual(try store.load().first?.status, .failed)
        XCTAssertThrowsError(try store.complete(id: "task-3", roleResults: [], finalResponse: "late result")) { error in
            XCTAssertEqual(error as? LocalAgentTaskHistoryStore.StoreError, .invalidTransition)
        }
    }

    func testDuplicateTaskIdentifiersAreRejected() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalAgentTaskHistoryStore(fileURL: root.appendingPathComponent("tasks.json"))
        try store.begin(id: "same-id", objective: "First task")

        XCTAssertThrowsError(try store.begin(id: "same-id", objective: "Duplicate")) { error in
            XCTAssertEqual(error as? LocalAgentTaskHistoryStore.StoreError, .duplicateTask)
        }
    }

    func testRetentionExpiresOldTasks() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixedNow = Date(timeIntervalSince1970: 2_000_000_000)
        let store = LocalAgentTaskHistoryStore(fileURL: root.appendingPathComponent("tasks.json"), now: { fixedNow })
        try store.begin(id: "old-task", objective: "Expired")
        try store.fail(id: "old-task", summary: "old")
        // Advance the injected clock beyond retention and load the archive.
        let laterStore = LocalAgentTaskHistoryStore(
            fileURL: root.appendingPathComponent("tasks.json"),
            now: { fixedNow.addingTimeInterval(LocalAgentTaskHistoryStore.retentionInterval + 1) }
        )

        XCTAssertTrue(try laterStore.load().isEmpty)
    }

    func testClearDeletesTaskArchive() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("tasks.json")
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        try store.begin(id: "task-4", objective: "Clear me")
        XCTAssertTrue(FileManager.default.fileExists(atPath: file.path))

        try store.clear()

        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertTrue(try store.load().isEmpty)
    }

    func testUnknownArchiveVersionFailsClosedAndPreservesFile() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("tasks.json")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let original = Data("{\"version\":99,\"savedAt\":\"2026-01-01T00:00:00Z\",\"tasks\":[]}".utf8)
        try original.write(to: file)
        let store = LocalAgentTaskHistoryStore(fileURL: file)

        XCTAssertThrowsError(try store.load()) { error in
            XCTAssertEqual(error as? LocalAgentTaskHistoryStore.StoreError, .unsupportedVersion)
        }
        XCTAssertEqual(try Data(contentsOf: file), original)
    }
}

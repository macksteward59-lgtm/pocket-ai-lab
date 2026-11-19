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
            createdAt: Date(),
            conversationID: "conversation-1",
            recipientAgentID: "researcher",
            messageType: "analysis",
            parentMessageID: nil
        )

        try store.begin(id: "task-1", objective: "Review architecture")
        try store.appendRoleResult(taskID: "task-1", result: role)
        try store.complete(id: "task-1", finalResponse: "Review complete")

        let restored = try store.load()
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(restored[0].id, "task-1")
        XCTAssertEqual(restored[0].status, .completed)
        XCTAssertEqual(restored[0].roleResults.count, 1)
        let restoredRole = try XCTUnwrap(restored[0].roleResults.first)
        XCTAssertEqual(restoredRole.id, role.id)
        XCTAssertEqual(restoredRole.role, role.role)
        XCTAssertEqual(restoredRole.sequence, role.sequence)
        XCTAssertEqual(restoredRole.text, role.text)
        XCTAssertEqual(restoredRole.conversationID, "conversation-1")
        XCTAssertEqual(restoredRole.recipientAgentID, "researcher")
        XCTAssertEqual(restoredRole.messageType, "analysis")
        XCTAssertNil(restoredRole.parentMessageID)
        // JSONEncoder's ISO-8601 strategy persists whole seconds. Compare
        // within that documented precision instead of Equatable Date equality.
        XCTAssertEqual(
            restoredRole.createdAt.timeIntervalSince1970,
            role.createdAt.timeIntervalSince1970,
            accuracy: 1.0
        )
        XCTAssertEqual(restored[0].finalResponse, "Review complete")
        XCTAssertNil(restored[0].failureSummary)
    }

    func testLegacyRoleJournalDecodesWithoutProtocolLinkageFields() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("tasks.json")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let legacy = Data("""
        {
          "version": 1,
          "savedAt": "2026-11-16T00:00:00Z",
          "tasks": [{
            "id": "legacy-task",
            "objective": "Legacy archive",
            "createdAt": "2026-11-16T00:00:00Z",
            "updatedAt": "2026-11-16T00:00:00Z",
            "status": "completed",
            "roleResults": [{
              "id": "legacy-message",
              "role": "reasoner",
              "sequence": 0,
              "text": "Existing result",
              "createdAt": "2026-11-16T00:00:00Z"
            }],
            "finalResponse": "Legacy complete",
            "failureSummary": null
          }]
        }
        """.utf8)
        try legacy.write(to: file)
        let store = LocalAgentTaskHistoryStore(fileURL: file)

        let restored = try XCTUnwrap(store.load().first)
        let role = try XCTUnwrap(restored.roleResults.first)
        XCTAssertEqual(role.id, "legacy-message")
        XCTAssertNil(role.conversationID)
        XCTAssertNil(role.recipientAgentID)
        XCTAssertNil(role.messageType)
        XCTAssertNil(role.parentMessageID)
        XCTAssertEqual(restored.finalResponse, "Legacy complete")
        XCTAssertEqual(try Data(contentsOf: file), legacy)
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
        XCTAssertThrowsError(try store.complete(id: "task-2", finalResponse: "unexpected")) { error in
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
        XCTAssertThrowsError(try store.complete(id: "task-3", finalResponse: "late result")) { error in
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

    func testRoleJournalRequiresMonotonicSequenceAndUniqueMessageIDs() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalAgentTaskHistoryStore(fileURL: root.appendingPathComponent("tasks.json"))
        try store.begin(id: "journal-task", objective: "Journal role outputs")
        let first = AgentTaskRoleResult(id: "message-0", role: "reasoner", sequence: 0, text: "first", createdAt: Date())
        let second = AgentTaskRoleResult(
            id: "message-1", role: "critic", sequence: 1, text: "second", createdAt: Date(),
            conversationID: "conversation-1", recipientAgentID: "user",
            messageType: "completion", parentMessageID: "message-0"
        )

        try store.appendRoleResult(taskID: "journal-task", result: first)
        XCTAssertThrowsError(try store.appendRoleResult(taskID: "journal-task", result: AgentTaskRoleResult(id: second.id, role: second.role, sequence: 2, text: second.text, createdAt: second.createdAt))) { error in
            XCTAssertEqual(error as? LocalAgentTaskHistoryStore.StoreError, .invalidTransition)
        }
        XCTAssertThrowsError(try store.appendRoleResult(taskID: "journal-task", result: first)) { error in
            XCTAssertEqual(error as? LocalAgentTaskHistoryStore.StoreError, .invalidTransition)
        }
        try store.appendRoleResult(taskID: "journal-task", result: second)

        let restored = try store.load().first
        XCTAssertEqual(restored?.roleResults.map(\.sequence), [0, 1])
        XCTAssertEqual(restored?.roleResults.map(\.id), ["message-0", "message-1"])
        XCTAssertEqual(restored?.roleResults.last?.parentMessageID, "message-0")
        XCTAssertEqual(restored?.roleResults.last?.conversationID, "conversation-1")
        XCTAssertEqual(restored?.roleResults.last?.recipientAgentID, "user")
        XCTAssertEqual(restored?.roleResults.last?.messageType, "completion")
    }

    func testInterruptedRecoveryPreservesPreviouslyJournaledRoleOutputs() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let store = LocalAgentTaskHistoryStore(fileURL: root.appendingPathComponent("tasks.json"))
        try store.begin(id: "partial-task", objective: "Stop after first role")
        let role = AgentTaskRoleResult(id: "partial-message", role: "reasoner", sequence: 0, text: "partial result", createdAt: Date())
        try store.appendRoleResult(taskID: "partial-task", result: role)

        let recovered = try store.load().first

        XCTAssertEqual(recovered?.status, .interrupted)
        XCTAssertEqual(recovered?.roleResults.count, 1)
        let recoveredRole = try XCTUnwrap(recovered?.roleResults.first)
        XCTAssertEqual(recoveredRole.id, role.id)
        XCTAssertEqual(recoveredRole.role, role.role)
        XCTAssertEqual(recoveredRole.sequence, role.sequence)
        XCTAssertEqual(recoveredRole.text, role.text)
        XCTAssertEqual(
            recoveredRole.createdAt.timeIntervalSince1970,
            role.createdAt.timeIntervalSince1970,
            accuracy: 1.0
        )
        XCTAssertTrue(recovered?.failureSummary?.contains("not resumed") == true)
    }
}

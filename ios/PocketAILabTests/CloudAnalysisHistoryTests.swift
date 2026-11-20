import XCTest
@testable import PocketAILab

final class CloudAnalysisHistoryTests: XCTestCase {
    private func configuration() throws -> CloudAnalysisConfiguration {
        try CloudAnalysisConfiguration(
            origin: URL(string: "https://gateway.example")!, profileID: "pocket-analysis-v1",
            requestedModel: "deepseek-flash", applicationToken: "fixture-app-token-at-least-32-characters"
        )
    }

    private func request(taskID: String = "task-1", text: String = "Selected task only") throws -> CloudAnalysisRequest {
        try CloudAnalysisRequest.prepare(taskID: taskID, inputText: text, configuration: configuration(), consent: true)
    }

    private func result(_ request: CloudAnalysisRequest, text: String = "Supplemental assessment") -> CloudAnalysisResult {
        CloudAnalysisResult(
            schemaVersion: 1, taskID: request.taskID, attemptID: request.attemptID,
            profileID: request.profileID, requestedModel: request.requestedModel,
            inputSHA256: request.inputSHA256, execution: "cloud", providerID: "deepseek",
            actualModel: "fixture-deepseek-flash", providerResponseID: "fixture-response",
            text: text, usage: CloudAnalysisUsage(promptTokens: 10, completionTokens: 4, totalTokens: 14),
            finishReason: "stop", authorized: false
        )
    }

    private func temporaryFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathComponent("tasks.json")
    }

    private func terminalTask(_ store: LocalAgentTaskHistoryStore, id: String = "task-1") throws {
        try store.begin(id: id, objective: "Existing local objective")
        try store.appendRoleResult(taskID: id, result: AgentTaskRoleResult(
            id: "role-\(id)", role: "reasoner", sequence: 0, text: "Local role result", createdAt: Date()
        ))
        try store.complete(id: id, finalResponse: "Original local team result")
    }

    func testCloudAttemptPreservesLocalOutcomeAndContainsNoCredential() throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        try terminalTask(store)
        let original = try XCTUnwrap(store.load().first)
        let request = try request()
        try store.beginCloudAnalysis(request: request, configuration: configuration())
        XCTAssertEqual(try store.snapshot().first?.cloudAnalysisAttempts?.first?.status, .submitting)
        try store.completeCloudAnalysis(taskID: request.taskID, attemptID: request.attemptID, result: result(request))
        let restored = try XCTUnwrap(store.load().first)
        XCTAssertEqual(restored.status, original.status)
        XCTAssertEqual(restored.roleResults, original.roleResults)
        XCTAssertEqual(restored.finalResponse, original.finalResponse)
        XCTAssertEqual(restored.cloudAnalysisAttempts?.first?.status, .completed)
        XCTAssertEqual(restored.cloudAnalysisAttempts?.first?.request.inputText, "Selected task only")
        XCTAssertEqual(restored.cloudAnalysisAttempts?.first?.result?.authorized, false)
        let archive = try String(contentsOf: file, encoding: .utf8)
        XCTAssertFalse(archive.contains("fixture-app-token"))
        XCTAssertFalse(archive.contains("applicationToken"))
    }

    func testRecoveryMarksPendingCloudUnknownWithoutChangingCompletedLocalTask() throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        try terminalTask(store)
        let request = try request()
        try store.beginCloudAnalysis(request: request, configuration: configuration())
        XCTAssertEqual(try store.snapshot().first?.cloudAnalysisAttempts?.first?.status, .submitting)
        let recovered = try XCTUnwrap(store.load().first)
        XCTAssertEqual(recovered.status, .completed)
        XCTAssertEqual(recovered.finalResponse, "Original local team result")
        XCTAssertEqual(recovered.cloudAnalysisAttempts?.first?.status, .unknown)
        XCTAssertEqual(recovered.cloudAnalysisAttempts?.first?.failureCode, "interrupted")
        XCTAssertThrowsError(try store.completeCloudAnalysis(taskID: request.taskID, attemptID: request.attemptID, result: result(request)))
    }

    func testRunningTaskAndDuplicateAttemptAreRejectedWithoutChangingArchive() throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        try store.begin(id: "task-1", objective: "Still running")
        let request = try request()
        let before = try Data(contentsOf: file)
        XCTAssertThrowsError(try store.beginCloudAnalysis(request: request, configuration: configuration()))
        XCTAssertEqual(try Data(contentsOf: file), before)
        try store.complete(id: "task-1", finalResponse: "Local result")
        try store.beginCloudAnalysis(request: request, configuration: configuration())
        try store.endCloudAnalysis(taskID: request.taskID, attemptID: request.attemptID, outcome: .unknown, code: "upstream_timeout")
        let completed = try Data(contentsOf: file)
        XCTAssertThrowsError(try store.beginCloudAnalysis(request: request, configuration: configuration()))
        XCTAssertEqual(try Data(contentsOf: file), completed)
    }

    func testMismatchedResultAndLateResultAfterDeletionCannotReplaceTask() throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        try terminalTask(store)
        let request = try request()
        try store.beginCloudAnalysis(request: request, configuration: configuration())
        let original = try Data(contentsOf: file)
        let otherRequest = try self.request(taskID: "other-task")
        XCTAssertThrowsError(try store.completeCloudAnalysis(taskID: request.taskID, attemptID: request.attemptID, result: result(otherRequest)))
        XCTAssertEqual(try Data(contentsOf: file), original)
        try store.clear()
        XCTAssertThrowsError(try store.completeCloudAnalysis(taskID: request.taskID, attemptID: request.attemptID, result: result(request)))
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testAttemptLimitAndPredispatchRejectionStayDistinctFromUnknownOutcome() throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        try terminalTask(store)
        for index in 0..<LocalAgentTaskHistoryStore.maximumCloudAttemptsPerTask {
            let request = try request()
            try store.beginCloudAnalysis(request: request, configuration: configuration())
            try store.endCloudAnalysis(taskID: request.taskID, attemptID: request.attemptID,
                                      outcome: index == 0 ? .notStarted : .unknown, code: "fixture")
        }
        let attempts = try XCTUnwrap(store.snapshot().first?.cloudAnalysisAttempts)
        XCTAssertEqual(attempts.first?.status, .rejected)
        XCTAssertEqual(attempts.last?.status, .unknown)
        XCTAssertThrowsError(try store.beginCloudAnalysis(request: request(), configuration: configuration()))
    }

    func testOlderTaskRemainsPersistedWhenNewCloudResultEvictsOtherHistory() throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        try terminalTask(store)
        for index in 0..<45 {
            let id = "newer-\(index)"
            try store.begin(id: id, objective: String(repeating: "x", count: 4_000))
            try store.complete(id: id, finalResponse: String(repeating: "y", count: 8_000))
            // Stop before the ordinary retention writer would evict task-1.
            if (try Data(contentsOf: file)).count > 510_000 { break }
        }
        XCTAssertTrue(try store.snapshot().contains(where: { $0.id == "task-1" }))
        // Place the archive exactly 2,000 bytes below capacity, independent of
        // platform JSON overhead. Replacing ASCII with escaped controls/quotes
        // keeps this existing objective within its 4,000-byte input limit.
        var archive = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        var archivedTasks = try XCTUnwrap(archive["tasks"] as? [[String: Any]])
        let encoded = try JSONSerialization.data(withJSONObject: archive, options: [.sortedKeys])
        let additionalBytes = LocalAgentTaskHistoryStore.maximumArchiveBytes - 2_000 - encoded.count
        XCTAssertGreaterThan(additionalBytes, 0)
        guard additionalBytes > 0 else { return }
        let controls = additionalBytes / 5
        let quotes = additionalBytes % 5
        XCTAssertLessThanOrEqual(controls + quotes, 4_000)
        guard controls + quotes <= 4_000 else { return }
        archivedTasks[0]["objective"] = String(repeating: "\u{0001}", count: controls) +
            String(repeating: "\"", count: quotes) + String(repeating: "x", count: 4_000 - controls - quotes)
        archive["tasks"] = archivedTasks
        let filled = try JSONSerialization.data(withJSONObject: archive, options: [.sortedKeys])
        XCTAssertEqual(filled.count, LocalAgentTaskHistoryStore.maximumArchiveBytes - 2_000)
        try filled.write(to: file, options: .atomic)
        let previousCount = try store.snapshot().count
        let request = try request(text: String(repeating: "z", count: 4_000))
        try store.beginCloudAnalysis(request: request, configuration: configuration())
        try store.completeCloudAnalysis(taskID: request.taskID, attemptID: request.attemptID,
                                        result: result(request, text: String(repeating: "a", count: 8_000)))
        let target = try XCTUnwrap(store.load().first(where: { $0.id == "task-1" }))
        XCTAssertEqual(target.cloudAnalysisAttempts?.first?.status, .completed)
        XCTAssertEqual(target.finalResponse, "Original local team result")
        XCTAssertLessThan(try store.snapshot().count, previousCount)
    }

    func testOversizedProtectedCloudFinalizationPreservesPendingArchive() throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        try store.begin(id: "task-1", objective: "Escaped JSON capacity")
        let escaped = String(repeating: "\u{0001}", count: 8_000)
        for index in 0..<8 {
            try store.appendRoleResult(taskID: "task-1", result: AgentTaskRoleResult(
                id: "role-\(index)", role: "reasoner", sequence: index, text: escaped, createdAt: Date()
            ))
        }
        try store.complete(id: "task-1", finalResponse: escaped)
        let first = try request(text: String(repeating: "\u{0001}", count: 4_000))
        try store.beginCloudAnalysis(request: first, configuration: configuration())
        try store.completeCloudAnalysis(taskID: first.taskID, attemptID: first.attemptID, result: result(first, text: escaped))
        let second = try request()
        try store.beginCloudAnalysis(request: second, configuration: configuration())
        let pending = try Data(contentsOf: file)
        XCTAssertThrowsError(try store.completeCloudAnalysis(taskID: second.taskID, attemptID: second.attemptID, result: result(second, text: escaped)))
        XCTAssertEqual(try Data(contentsOf: file), pending)
        XCTAssertEqual(try store.snapshot().first?.cloudAnalysisAttempts?.last?.status, .submitting)
        XCTAssertEqual(try store.load().first?.cloudAnalysisAttempts?.last?.status, .unknown)
    }

    func testRecoveryCannotEvictNearCapacityPendingCloudTask() throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        try store.begin(id: "task-1", objective: "Capacity recovery")
        let escaped = String(repeating: "\u{0001}", count: 8_000)
        for index in 0..<8 {
            try store.appendRoleResult(taskID: "task-1", result: AgentTaskRoleResult(
                id: "role-\(index)", role: "reasoner", sequence: index, text: escaped, createdAt: Date()
            ))
        }
        try store.complete(id: "task-1", finalResponse: escaped)
        let first = try request(text: String(repeating: "\u{0001}", count: 4_000))
        try store.beginCloudAnalysis(request: first, configuration: configuration())
        try store.completeCloudAnalysis(taskID: first.taskID, attemptID: first.attemptID, result: result(first, text: escaped))
        let pending = try request(text: String(repeating: "\u{0001}", count: 2_000))
        try store.beginCloudAnalysis(request: pending, configuration: configuration())

        // Construct a valid, near-capacity archive. All individual fields remain
        // within their text limits; escaped controls consume six JSON bytes.
        var archive = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
        var tasks = try XCTUnwrap(archive["tasks"] as? [[String: Any]])
        let originalObjective = try XCTUnwrap(tasks[0]["objective"] as? String)
        let encoded = try JSONSerialization.data(withJSONObject: archive, options: [.sortedKeys])
        let paddingBytes = LocalAgentTaskHistoryStore.maximumArchiveBytes - 1 - encoded.count
        XCTAssertGreaterThan(paddingBytes, 0)
        guard paddingBytes > 0 else { return }
        let padding = String(repeating: "\u{0001}", count: paddingBytes / 6) + String(repeating: "x", count: paddingBytes % 6)
        XCTAssertLessThanOrEqual((originalObjective + padding).utf8.count, 4_000)
        tasks[0]["objective"] = originalObjective + padding
        archive["tasks"] = tasks
        let before = try JSONSerialization.data(withJSONObject: archive, options: [.sortedKeys])
        XCTAssertEqual(before.count, LocalAgentTaskHistoryStore.maximumArchiveBytes - 1)
        try before.write(to: file, options: .atomic)

        // Adding the honest interrupted/unknown status must fail before writing
        // if it cannot fit, rather than replacing the only task with an empty list.
        XCTAssertThrowsError(try store.load())
        XCTAssertEqual(try Data(contentsOf: file), before)
        XCTAssertEqual(try store.snapshot().first?.cloudAnalysisAttempts?.last?.status, .submitting)
    }
}

import XCTest
@testable import PocketAILab

private actor CloudAnalysisSpy: CloudAnalysisSending {
    enum Mode: Sendable, Equatable { case success, mismatch, timeout, rejected }
    let file: URL
    let mode: Mode
    private var callCount = 0
    private var observedSavedAttempt = false

    init(file: URL, mode: Mode = .success) { self.file = file; self.mode = mode }

    func observations() -> (calls: Int, persisted: Bool) { (callCount, observedSavedAttempt) }

    func send(request: CloudAnalysisRequest, configuration: CloudAnalysisConfiguration) async throws -> CloudAnalysisResult {
        callCount += 1
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        observedSavedAttempt = try store.snapshot().contains { task in
            task.id == request.taskID && (task.cloudAnalysisAttempts ?? []).contains {
                $0.request == request && $0.status == .submitting
            }
        }
        switch mode {
        case .timeout: throw CloudAnalysisError.gateway(code: "upstream_timeout", outcome: .unknown)
        case .rejected: throw CloudAnalysisError.gateway(code: "busy", outcome: .notStarted)
        case .success, .mismatch: break
        }
        return CloudAnalysisResult(
            schemaVersion: 1, taskID: mode == .mismatch ? "wrong-task" : request.taskID,
            attemptID: request.attemptID, profileID: request.profileID,
            requestedModel: request.requestedModel, inputSHA256: request.inputSHA256,
            execution: "cloud", providerID: "deepseek", actualModel: "fixture-deepseek-flash",
            providerResponseID: "fixture-response", text: "Declared fixture assessment",
            usage: CloudAnalysisUsage(promptTokens: 10, completionTokens: 3, totalTokens: 13),
            finishReason: "stop", authorized: false
        )
    }
}

final class CloudAnalysisIntegrationTests: XCTestCase {
    private func configuration() throws -> CloudAnalysisConfiguration {
        try CloudAnalysisConfiguration(
            origin: URL(string: "https://gateway.example")!, profileID: "pocket-analysis-v1",
            requestedModel: "deepseek-flash", applicationToken: "fixture-app-token-at-least-32-characters"
        )
    }

    private func seed(file: URL) throws {
        let store = LocalAgentTaskHistoryStore(fileURL: file)
        try store.begin(id: "existing-task", objective: "Existing local objective")
        try store.complete(id: "existing-task", finalResponse: "Original local result")
    }

    @MainActor
    private func model(file: URL, client: any CloudAnalysisSending) -> LocalChatModel {
        let root = file.deletingLastPathComponent()
        let models = root.appendingPathComponent("Models")
        return LocalChatModel(
            modelDirectory: models,
            conversationStore: LocalConversationStore(fileURL: root.appendingPathComponent("chat.json")),
            agentTaskHistoryStore: LocalAgentTaskHistoryStore(fileURL: file),
            modelCatalogStore: LocalModelCatalogStore(fileURL: root.appendingPathComponent("catalog.json"), modelDirectory: models),
            cloudAnalysisClient: client,
            availableMemoryMB: { 4_096 }
        )
    }

    @MainActor
    func testExplicitCloudAnalysisSavesBeforeSendAndKeepsOriginalTaskAndLocalRuntime() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("tasks.json")
        try seed(file: file)
        let spy = CloudAnalysisSpy(file: file)
        let model = model(file: file, client: spy)
        let configuration = try configuration()
        let request = try CloudAnalysisRequest.prepare(
            taskID: "existing-task", inputText: "Only explicitly selected text",
            configuration: configuration, consent: true
        )
        await model.runCloudAnalysis(request: request, configuration: configuration)
        let observations = await spy.observations()
        XCTAssertEqual(observations.calls, 1)
        XCTAssertTrue(observations.persisted)
        let task = try XCTUnwrap(model.agentTaskHistory.first)
        XCTAssertEqual(task.id, "existing-task")
        XCTAssertEqual(task.status, .completed)
        XCTAssertEqual(task.finalResponse, "Original local result")
        XCTAssertEqual(task.cloudAnalysisAttempts?.first?.status, .completed)
        XCTAssertEqual(task.cloudAnalysisAttempts?.first?.request.inputText, "Only explicitly selected text")
        XCTAssertFalse(model.isModelLoaded)
        XCTAssertFalse(model.isBusy)
        XCTAssertTrue(model.messages.isEmpty)
    }

    @MainActor
    func testInvalidConsentMissingTaskAndUnwritableHistoryNeverCallClient() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("tasks.json")
        try seed(file: file)
        let spy = CloudAnalysisSpy(file: file)
        let model = model(file: file, client: spy)
        let configuration = try configuration()
        let valid = try CloudAnalysisRequest.prepare(
            taskID: "existing-task", inputText: "Selected text", configuration: configuration, consent: true
        )
        let unapproved = CloudAnalysisRequest(
            schemaVersion: 1, taskID: valid.taskID, attemptID: valid.attemptID,
            profileID: valid.profileID, requestedModel: valid.requestedModel,
            inputText: valid.inputText, inputSHA256: valid.inputSHA256,
            consentExpiresAt: valid.consentExpiresAt, remoteConsent: false, maxOutputTokens: 512
        )
        await model.runCloudAnalysis(request: unapproved, configuration: configuration)
        let missing = try CloudAnalysisRequest.prepare(
            taskID: "missing-task", inputText: "Selected text", configuration: configuration, consent: true
        )
        await model.runCloudAnalysis(request: missing, configuration: configuration)
        // A non-file path is a deterministic storage failure, independent of
        // simulator user permissions. The production model must not dispatch.
        try FileManager.default.removeItem(at: file)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        await model.runCloudAnalysis(request: valid, configuration: configuration)
        let observations = await spy.observations()
        XCTAssertEqual(observations.calls, 0)
        XCTAssertFalse(model.isBusy)
        XCTAssertEqual(model.agentTaskHistory.first?.finalResponse, "Original local result")
    }

    @MainActor
    func testMismatchedInjectedClientResultIsUnknownAndNeverAttached() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("tasks.json")
        try seed(file: file)
        let spy = CloudAnalysisSpy(file: file, mode: .mismatch)
        let model = model(file: file, client: spy)
        let configuration = try configuration()
        let request = try CloudAnalysisRequest.prepare(
            taskID: "existing-task", inputText: "Selected text", configuration: configuration, consent: true
        )
        await model.runCloudAnalysis(request: request, configuration: configuration)
        let observations = await spy.observations()
        XCTAssertEqual(observations.calls, 1)
        XCTAssertEqual(model.agentTaskHistory.first?.cloudAnalysisAttempts?.first?.status, .unknown)
        XCTAssertNil(model.agentTaskHistory.first?.cloudAnalysisAttempts?.first?.result)
        XCTAssertEqual(model.agentTaskHistory.first?.finalResponse, "Original local result")
    }

    @MainActor
    func testTimeoutIsUnknownAndNotStartedRejectionRemainsSeparateWithoutRetry() async throws {
        for (mode, expected) in [(CloudAnalysisSpy.Mode.timeout, CloudAnalysisAttemptStatus.unknown), (.rejected, .rejected)] {
            let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
            defer { try? FileManager.default.removeItem(at: root) }
            let file = root.appendingPathComponent("tasks.json")
            try seed(file: file)
            let spy = CloudAnalysisSpy(file: file, mode: mode)
            let model = model(file: file, client: spy)
            let configuration = try configuration()
            let request = try CloudAnalysisRequest.prepare(
                taskID: "existing-task", inputText: "Selected text", configuration: configuration, consent: true
            )
            await model.runCloudAnalysis(request: request, configuration: configuration)
            let observations = await spy.observations()
            XCTAssertEqual(observations.calls, 1)
            XCTAssertEqual(model.agentTaskHistory.first?.cloudAnalysisAttempts?.first?.status, expected)
            XCTAssertEqual(model.agentTaskHistory.first?.finalResponse, "Original local result")
            XCTAssertFalse(model.isBusy)
        }
    }
}

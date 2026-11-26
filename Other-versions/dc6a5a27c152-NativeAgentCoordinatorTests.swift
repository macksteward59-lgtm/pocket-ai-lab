import XCTest
@testable import PocketLlamaEngine

final class NativeAgentCoordinatorTests: XCTestCase {
    func testSequentialRolesProduceLinkedMessagesAndFinalResponse() async throws {
        let engine = RecordingInferenceEngine(responses: ["reasoned", "criticized", "validated"])
        let session = RuntimeSession(id: "session-1", modelId: "local-model")
        let coordinator = NativeAgentCoordinator(engine: engine, session: session)
        let task = AgentTaskRequest(id: "task-1", objective: "Review the runtime architecture",
                                    requiredCapabilities: ["reasoning", "security"])
        let steps = [
            NativeAgentStep(agentId: "reasoner", instructions: "Analyze the design."),
            NativeAgentStep(agentId: "critic", instructions: "Find weaknesses.", messageType: .counterargument),
            NativeAgentStep(agentId: "validator", instructions: "Check the conclusions.", messageType: .validation)
        ]

        let result = try await coordinator.run(task: task, conversationId: "conversation-1", steps: steps)
        XCTAssertEqual(result.messages.count, 3)
        XCTAssertEqual(result.finalResponse, "validated")
        XCTAssertEqual(result.messages[0].sequence, 0)
        XCTAssertEqual(result.messages[1].parentMessageId, result.messages[0].messageId)
        XCTAssertEqual(result.messages[2].parentMessageId, result.messages[1].messageId)
        XCTAssertEqual(result.messages[0].recipientAgentId, "critic")
        XCTAssertEqual(result.messages[2].recipientAgentId, "user")
        let prompts = await engine.recordedPrompts
        XCTAssertEqual(prompts.count, 3)
        XCTAssertTrue(prompts[1].contains("UNTRUSTED PROPOSAL FROM reasoner"))
        XCTAssertTrue(prompts[2].contains("UNTRUSTED PROPOSAL FROM critic"))
    }

    func testEmptyPlanIsRejectedBeforeInference() async {
        let engine = RecordingInferenceEngine(responses: [])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: "Do work", requiredCapabilities: []),
                steps: []
            )
            XCTFail("empty plan should be rejected")
        } catch NativeAgentCoordinatorError.invalidPlan {
        } catch {
            XCTFail("unexpected error: \(error)")
        }
        let count = await engine.recordedPrompts.count
        XCTAssertEqual(count, 0)
    }

    func testEmptyModelOutputDoesNotProduceAgentMessage() async {
        let engine = RecordingInferenceEngine(responses: ["  "])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: "Do work", requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Analyze")]
            )
            XCTFail("empty output should fail")
        } catch NativeAgentCoordinatorError.emptyModelResponse {
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testOversizedTaskAndPlanAreRejectedBeforeInference() async {
        let engine = RecordingInferenceEngine(responses: [])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: String(repeating: "x", count: 4_001),
                    requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Analyze")]
            )
            XCTFail("oversized objective should be rejected")
        } catch NativeAgentCoordinatorError.invalidTask {
        } catch {
            XCTFail("unexpected error: \(error)")
        }

        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: String(repeating: "界", count: 1_500),
                    requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Analyze")]
            )
            XCTFail("oversized UTF-8 objective should be rejected")
        } catch NativeAgentCoordinatorError.invalidTask {
        } catch {
            XCTFail("unexpected error: \(error)")
        }

        let tooManySteps = (0..<9).map {
            NativeAgentStep(agentId: "role-\($0)", instructions: "Analyze")
        }
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: "Do work", requiredCapabilities: []),
                steps: tooManySteps
            )
            XCTFail("too many roles should be rejected")
        } catch NativeAgentCoordinatorError.invalidPlan {
        } catch {
            XCTFail("unexpected error: \(error)")
        }

        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: "Do work", requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Analyze")],
                maxTokens: 513
            )
            XCTFail("per-step token budget should be bounded")
        } catch NativeAgentCoordinatorError.invalidPlan {
        } catch {
            XCTFail("unexpected error: \(error)")
        }
        let count = await engine.recordedPrompts.count
        XCTAssertEqual(count, 0)
    }

    func testPriorRoleOutputIsTruncatedBeforeItEntersTheNextPrompt() async throws {
        let engine = RecordingInferenceEngine(responses: [
            String(repeating: "A", count: 2_000),
            "criticized"
        ])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        _ = try await coordinator.run(
            task: AgentTaskRequest(id: "t", objective: "Review this", requiredCapabilities: []),
            steps: [
                NativeAgentStep(agentId: "reasoner", instructions: "Analyze"),
                NativeAgentStep(agentId: "critic", instructions: "Challenge")
            ],
            maxTokens: 128
        )
        let prompts = await engine.recordedPrompts
        XCTAssertEqual(prompts.count, 2)
        XCTAssertTrue(prompts[1].contains("[truncated]"))
        XCTAssertLessThanOrEqual(prompts[1].count, 12_000)
    }

    func testOversizedModelResponseIsRejectedAndCancelled() async {
        let engine = RecordingInferenceEngine(responses: [String(repeating: "x", count: 8_001)])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: "Do work", requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Analyze")]
            )
            XCTFail("oversized response should fail")
        } catch NativeAgentCoordinatorError.responseTooLarge {
        } catch {
            XCTFail("unexpected error: \(error)")
        }
        let cancellations = await engine.cancelledRequestIDs
        XCTAssertEqual(cancellations.count, 1)
    }
    func testMessageSinkReceivesEachCompletedRoleInSequence() async throws {
        let engine = RecordingInferenceEngine(responses: ["reasoned", "criticized"])
        let coordinator = NativeAgentCoordinator(
            engine: engine,
            session: RuntimeSession(id: "s", modelId: "m")
        )
        let recorder = AgentMessageRecorder()
        let result = try await coordinator.run(
            task: AgentTaskRequest(id: "task", objective: "Review", requiredCapabilities: []),
            steps: [
                NativeAgentStep(agentId: "reasoner", instructions: "Analyze"),
                NativeAgentStep(agentId: "critic", instructions: "Challenge")
            ],
            onMessage: { message in await recorder.record(message) }
        )

        let recorded = await recorder.messages
        XCTAssertEqual(result.messages, recorded)
        XCTAssertEqual(recorded.map(\.sequence), [0, 1])
        XCTAssertEqual(recorded.map(\.senderAgentId), ["reasoner", "critic"])
    }

    func testRejectedMessageSinkStopsBeforeTheNextRoleRuns() async {
        let engine = RecordingInferenceEngine(responses: ["reasoned", "must-not-run"])
        let coordinator = NativeAgentCoordinator(
            engine: engine,
            session: RuntimeSession(id: "s", modelId: "m")
        )
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "task", objective: "Review", requiredCapabilities: []),
                steps: [
                    NativeAgentStep(agentId: "reasoner", instructions: "Analyze"),
                    NativeAgentStep(agentId: "critic", instructions: "Challenge")
                ],
                onMessage: { _ in false }
            )
            XCTFail("rejected durable message should stop the run")
        } catch NativeAgentCoordinatorError.messageSinkRejected {
        } catch {
            XCTFail("unexpected error: \(error)")
        }
        let prompts = await engine.recordedPrompts
        XCTAssertEqual(prompts.count, 1)
    }

}

private actor AgentMessageRecorder {
    private(set) var messages: [AgentMessageEnvelope] = []
    func record(_ message: AgentMessageEnvelope) -> Bool {
        messages.append(message)
        return true
    }
}

private actor RecordingInferenceEngine: LlamaEngine {
    private var responses: [String]
    private(set) var recordedPrompts: [String] = []
    private(set) var cancelledRequestIDs: [String] = []

    init(responses: [String]) { self.responses = responses }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: "session", modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        recordedPrompts.append(request.prompt)
        let response = responses.isEmpty ? "" : responses.removeFirst()
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: response, isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async { cancelledRequestIDs.append(requestId) }
    func cancelAndWait(sessionId: String, requestId: String) async { cancelledRequestIDs.append(requestId) }
    func unload(sessionId: String) async {}
}

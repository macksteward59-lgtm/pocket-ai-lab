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
        XCTAssertEqual(await engine.recordedPrompts.count, 3)
        let prompts = await engine.recordedPrompts
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
}

private actor RecordingInferenceEngine: LlamaEngine {
    private var responses: [String]
    private(set) var recordedPrompts: [String] = []

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

    func cancel(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
}

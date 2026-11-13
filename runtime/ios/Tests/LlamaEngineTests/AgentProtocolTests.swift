import XCTest
@testable import PocketLlamaEngine

final class AgentProtocolTests: XCTestCase {
    func testTaskContractRoundTripsWithStableWireNames() throws {
        let task = AgentTaskRequest(id: "task-1", objective: "Review architecture",
                                    requiredCapabilities: ["reasoning", "security"])
        let data = try JSONEncoder().encode(task)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["requiredCapabilities"] as? [String], ["reasoning", "security"])
        XCTAssertEqual(try JSONDecoder().decode(AgentTaskRequest.self, from: data), task)
    }

    func testMessageEnvelopeRoundTripsAndPreservesSnakeCaseMessageType() throws {
        let message = AgentMessageEnvelope(
            messageId: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!,
            taskId: "task-1", conversationId: "conversation-1",
            senderAgentId: "reasoner", recipientAgentId: "critic",
            messageType: .analysis, payload: .object(["analysis": .string("proposal")]),
            createdAt: "2026-11-13T00:00:00.000Z", sequence: 0
        )
        let data = try JSONEncoder().encode(message)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["messageType"] as? String, "analysis")
        XCTAssertEqual(try JSONDecoder().decode(AgentMessageEnvelope.self, from: data), message)
    }

    func testReadinessNeverAcceptsMissingOrStructurallyInvalidProof() async {
        let verifier = RejectingRuntimeProofVerifier()
        let missing = await RuntimeReadinessEvaluator.evaluate(nil, expectedModelId: "m",
            expectedModelFileSHA256: String(repeating: "a", count: 64), verifier: verifier)
        XCTAssertEqual(missing, .unavailable)
        let invalid = RuntimeSessionProof(sessionId: "s", modelId: "m", modelFileSHA256: "bad",
            runtimeBuildId: "build", expiresAt: "2030-01-01T00:00:00.000Z",
            generationCounter: 1, keyId: "key", signature: "sig")
        let state = await RuntimeReadinessEvaluator.evaluate(invalid, expectedModelId: "m",
            expectedModelFileSHA256: String(repeating: "a", count: 64), verifier: verifier)
        XCTAssertEqual(state, .unavailable)
    }

    func testExpiredProofDoesNotReachVerifier() async {
        let verifier = RejectingRuntimeProofVerifier()
        let proof = RuntimeSessionProof(sessionId: "s", modelId: "m",
            modelFileSHA256: String(repeating: "a", count: 64), runtimeBuildId: "build",
            expiresAt: "2020-01-01T00:00:00.000Z", generationCounter: 1,
            keyId: "key", signature: "sig")
        let state = await RuntimeReadinessEvaluator.evaluate(proof, expectedModelId: "m",
            expectedModelFileSHA256: proof.modelFileSHA256, verifier: verifier,
            now: ISO8601DateFormatter().date(from: "2026-11-13T00:00:00.000Z")!)
        XCTAssertEqual(state, .expired)
        XCTAssertEqual(await verifier.calls, 0)
    }
}

private actor RejectingRuntimeProofVerifier: RuntimeProofVerifier {
    private(set) var calls = 0
    func verify(_ proof: RuntimeSessionProof, expectedModelId: String,
                expectedModelFileSHA256: String) async -> Bool {
        calls += 1
        return false
    }
}

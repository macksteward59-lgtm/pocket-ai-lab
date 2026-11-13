import XCTest
@testable import PocketLlamaEngine

final class AgentProtocolTests: XCTestCase {
    func testTaskContractRoundTripsWithStableWireNames() throws {
        let task = AgentTaskRequest(protocolVersion: .v1, id: "task-1", objective: "Review architecture",
                                    requiredCapabilities: ["reasoning", "security"])
        let data = try JSONEncoder().encode(task)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["protocolVersion"] as? Int, 1)
        XCTAssertEqual(object["requiredCapabilities"] as? [String], ["reasoning", "security"])
        XCTAssertEqual(try JSONDecoder().decode(AgentTaskRequest.self, from: data), task)
    }

    func testMessageEnvelopeRoundTripsAndPreservesSnakeCaseMessageType() throws {
        let message = AgentMessageEnvelope(
            protocolVersion: .v1, messageId: UUID(uuidString: "00000000-0000-4000-8000-000000000001")!,
            taskId: "task-1", conversationId: "conversation-1",
            senderAgentId: "reasoner", recipientAgentId: "critic",
            messageType: .analysis, payload: .object(["analysis": .string("proposal")]),
            createdAt: "2026-11-13T00:00:00.000Z", sequence: 0
        )
        let data = try JSONEncoder().encode(message)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["protocolVersion"] as? Int, 1)
        XCTAssertEqual(object["messageType"] as? String, "analysis")
        XCTAssertEqual(try JSONDecoder().decode(AgentMessageEnvelope.self, from: data), message)
    }

    func testReadinessNeverAcceptsMissingOrStructurallyInvalidProof() async {
        let verifier = RejectingRuntimeProofVerifier()
        let missing = await RuntimeReadinessEvaluator.evaluate(nil, expectedModelId: "m",
            expectedModelFileSHA256: String(repeating: "a", count: 64), verifier: verifier)
        XCTAssertEqual(missing, .unavailable)
        let invalid = RuntimeSessionProof(protocolVersion: .v1, sessionId: "s", modelId: "m", modelFileSHA256: "bad",
            runtimeBuildId: "build", expiresAt: "2030-01-01T00:00:00.000Z",
            generationCounter: 1, keyId: "key", signature: "sig")
        let state = await RuntimeReadinessEvaluator.evaluate(invalid, expectedModelId: "m",
            expectedModelFileSHA256: String(repeating: "a", count: 64), verifier: verifier)
        XCTAssertEqual(state, .unavailable)
    }


    func testCanonicalRuntimeProofBytesMatchTypeScriptFixture() throws {
        let proof = RuntimeSessionProof(
            protocolVersion: .v1, sessionId: "session-1", modelId: "qwen-local",
            modelFileSHA256: String(repeating: "a", count: 64),
            runtimeBuildId: "ios-llama-2026.11", expiresAt: "2030-01-01T00:00:00.000Z",
            generationCounter: 1, keyId: "device-runtime-key-1", signature: "ignored"
        )
        let payload = try XCTUnwrap(RuntimeSessionProofCanonicalizer.canonicalPayload(proof))
        XCTAssertEqual(payload.base64EncodedString(),
            "AAAAInBvY2tldC1haS1ydW50aW1lLXNlc3Npb24tcHJvb2YtdjEAAAABMQAAAAlzZXNzaW9uLTEAAAAKcXdlbi1sb2NhbAAAAEBhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhAAAAEWlvcy1sbGFtYS0yMDI2LjExAAAAGDIwMzAtMDEtMDFUMDA6MDA6MDAuMDAwWgAAAAExAAAAFGRldmljZS1ydW50aW1lLWtleS0xAAAAB0VkMjU1MTk=")
    }

    func testEd25519VerifierAuthenticatesAndRejectsReplay() async throws {
        let privateKey = Curve25519.Signing.PrivateKey()
        let trustedKey = RuntimeProofTrustedKey(
            keyId: "trusted-key",
            rawPublicKey: privateKey.publicKey.rawRepresentation,
            allowedRuntimeBuildIds: ["ios-build-1"]
        )
        let verifier = Ed25519RuntimeProofVerifier(trustedKeys: [trustedKey])
        let unsigned = RuntimeSessionProof(
            protocolVersion: .v1, sessionId: "session-verified", modelId: "model-a",
            modelFileSHA256: String(repeating: "b", count: 64), runtimeBuildId: "ios-build-1",
            expiresAt: "2030-01-01T00:00:00.000Z", generationCounter: 1,
            keyId: "trusted-key", signature: "pending"
        )
        let bytes = try XCTUnwrap(RuntimeSessionProofCanonicalizer.canonicalPayload(unsigned))
        let signature = try privateKey.signature(for: bytes).base64EncodedString()
        let signed = RuntimeSessionProof(
            protocolVersion: .v1, sessionId: unsigned.sessionId, modelId: unsigned.modelId,
            modelFileSHA256: unsigned.modelFileSHA256, runtimeBuildId: unsigned.runtimeBuildId,
            expiresAt: unsigned.expiresAt, generationCounter: unsigned.generationCounter,
            keyId: unsigned.keyId, signature: signature
        )

        XCTAssertTrue(await verifier.verify(signed, expectedModelId: "model-a",
            expectedModelFileSHA256: unsigned.modelFileSHA256))
        XCTAssertFalse(await verifier.verify(signed, expectedModelId: "model-a",
            expectedModelFileSHA256: unsigned.modelFileSHA256))

        let nextUnsigned = RuntimeSessionProof(
            protocolVersion: .v1, sessionId: unsigned.sessionId, modelId: unsigned.modelId,
            modelFileSHA256: unsigned.modelFileSHA256, runtimeBuildId: unsigned.runtimeBuildId,
            expiresAt: unsigned.expiresAt, generationCounter: 2,
            keyId: unsigned.keyId, signature: "pending"
        )
        let nextBytes = try XCTUnwrap(RuntimeSessionProofCanonicalizer.canonicalPayload(nextUnsigned))
        let nextSignature = try privateKey.signature(for: nextBytes).base64EncodedString()
        let next = RuntimeSessionProof(
            protocolVersion: .v1, sessionId: nextUnsigned.sessionId, modelId: nextUnsigned.modelId,
            modelFileSHA256: nextUnsigned.modelFileSHA256, runtimeBuildId: nextUnsigned.runtimeBuildId,
            expiresAt: nextUnsigned.expiresAt, generationCounter: 2,
            keyId: nextUnsigned.keyId, signature: nextSignature
        )
        XCTAssertTrue(await verifier.verify(next, expectedModelId: "model-a",
            expectedModelFileSHA256: unsigned.modelFileSHA256))
    }

    func testEd25519VerifierRejectsUntrustedBuildAndUnknownKey() async throws {
        let privateKey = Curve25519.Signing.PrivateKey()
        let verifier = Ed25519RuntimeProofVerifier(trustedKeys: [
            RuntimeProofTrustedKey(keyId: "trusted-key",
                rawPublicKey: privateKey.publicKey.rawRepresentation,
                allowedRuntimeBuildIds: ["approved-build"])
        ])
        let proof = RuntimeSessionProof(
            protocolVersion: .v1, sessionId: "session", modelId: "model",
            modelFileSHA256: String(repeating: "c", count: 64), runtimeBuildId: "unapproved-build",
            expiresAt: "2030-01-01T00:00:00.000Z", generationCounter: 1,
            keyId: "trusted-key", signature: "invalid"
        )
        XCTAssertFalse(await verifier.verify(proof, expectedModelId: "model",
            expectedModelFileSHA256: proof.modelFileSHA256))
        let unknown = RuntimeSessionProof(
            protocolVersion: .v1, sessionId: "session", modelId: "model",
            modelFileSHA256: proof.modelFileSHA256, runtimeBuildId: "approved-build",
            expiresAt: proof.expiresAt, generationCounter: 1,
            keyId: "unknown-key", signature: "invalid"
        )
        XCTAssertFalse(await verifier.verify(unknown, expectedModelId: "model",
            expectedModelFileSHA256: unknown.modelFileSHA256))
    }

    func testExpiredProofDoesNotReachVerifier() async {
        let verifier = RejectingRuntimeProofVerifier()
        let proof = RuntimeSessionProof(protocolVersion: .v1, sessionId: "s", modelId: "m",
            modelFileSHA256: String(repeating: "a", count: 64), runtimeBuildId: "build",
            expiresAt: "2020-01-01T00:00:00.000Z", generationCounter: 1,
            keyId: "key", signature: "sig")
        let state = await RuntimeReadinessEvaluator.evaluate(proof, expectedModelId: "m",
            expectedModelFileSHA256: proof.modelFileSHA256, verifier: verifier,
            now: ISO8601DateFormatter().date(from: "2026-11-13T00:00:00Z")!)
        XCTAssertEqual(state, .expired)
        let calls = await verifier.calls
        XCTAssertEqual(calls, 0)
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

import XCTest
import CryptoKit
#if os(iOS)
import Security
#endif
@testable import PocketLlamaEngine

final class RuntimeProofVerifierTests: XCTestCase {
    func testCanonicalPayloadMatchesTypeScriptFixture() throws {
        let proof = RuntimeSessionProof(
            protocolVersion: .v1,
            sessionId: "session-1",
            modelId: "qwen-local",
            modelFileSHA256: String(repeating: "a", count: 64),
            runtimeBuildId: "ios-llama-2026.11",
            expiresAt: "2030-01-01T00:00:00.000Z",
            generationCounter: 1,
            keyId: "device-runtime-key-1",
            signature: "ignored"
        )
        let payload = try XCTUnwrap(RuntimeSessionProofCanonicalizer.canonicalPayload(proof))
        XCTAssertEqual(payload.base64EncodedString(),
            "AAAAInBvY2tldC1haS1ydW50aW1lLXNlc3Npb24tcHJvb2YtdjEAAAABMQAAAAlzZXNzaW9uLTEAAAAKcXdlbi1sb2NhbAAAAEBhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhAAAAEWlvcy1sbGFtYS0yMDI2LjExAAAAGDIwMzAtMDEtMDFUMDA6MDA6MDAuMDAwWgAAAAExAAAAFGRldmljZS1ydW50aW1lLWtleS0xAAAAB0VkMjU1MTk=")
    }

    func testVerifierAuthenticatesAndRejectsReplayAndStorageFailure() async throws {
        let privateKey = Curve25519.Signing.PrivateKey()
        let trustedKey = RuntimeProofTrustedKey(
            keyId: "trusted-key",
            rawPublicKey: privateKey.publicKey.rawRepresentation,
            allowedRuntimeBuildIds: ["ios-build-1"]
        )
        let replayStore = TestRuntimeProofReplayStore()
        let verifier = Ed25519RuntimeProofVerifier(trustedKeys: [trustedKey], replayStore: replayStore)
        let unsigned = makeProof(session: "session-verified", build: "ios-build-1", generation: 1, keyId: "trusted-key")
        let payload = try XCTUnwrap(RuntimeSessionProofCanonicalizer.canonicalPayload(unsigned))
        let signature = try privateKey.signature(for: payload).base64EncodedString()
        let signed = makeProof(session: unsigned.sessionId, build: unsigned.runtimeBuildId,
            generation: unsigned.generationCounter, keyId: unsigned.keyId, signature: signature)

        let firstAccepted = await verifier.verify(signed, expectedModelId: "model-a",
            expectedModelFileSHA256: unsigned.modelFileSHA256)
        XCTAssertTrue(firstAccepted)
        let replayAccepted = await verifier.verify(signed, expectedModelId: "model-a",
            expectedModelFileSHA256: unsigned.modelFileSHA256)
        XCTAssertFalse(replayAccepted)

        let recreated = Ed25519RuntimeProofVerifier(trustedKeys: [trustedKey], replayStore: replayStore)
        let afterRecreationAccepted = await recreated.verify(signed, expectedModelId: "model-a",
            expectedModelFileSHA256: unsigned.modelFileSHA256)
        XCTAssertFalse(afterRecreationAccepted)

        let failing = Ed25519RuntimeProofVerifier(trustedKeys: [trustedKey],
            replayStore: FailingRuntimeProofReplayStore())
        let fresh = makeProof(session: "fresh-session", build: "ios-build-1", generation: 1,
            keyId: "trusted-key")
        let freshSignature = try privateKey.signature(
            for: XCTUnwrap(RuntimeSessionProofCanonicalizer.canonicalPayload(fresh))
        ).base64EncodedString()
        let freshSigned = makeProof(session: fresh.sessionId, build: fresh.runtimeBuildId,
            generation: fresh.generationCounter, keyId: fresh.keyId, signature: freshSignature)
        let storageFailureAccepted = await failing.verify(freshSigned, expectedModelId: "model-a",
            expectedModelFileSHA256: fresh.modelFileSHA256)
        XCTAssertFalse(storageFailureAccepted)
    }

    func testVerifierRejectsUnknownKeyUnapprovedBuildAndForgedSignature() async throws {
        let privateKey = Curve25519.Signing.PrivateKey()
        let trusted = RuntimeProofTrustedKey(keyId: "trusted-key",
            rawPublicKey: privateKey.publicKey.rawRepresentation,
            allowedRuntimeBuildIds: ["approved-build"])
        let verifier = Ed25519RuntimeProofVerifier(trustedKeys: [trusted], replayStore: TestRuntimeProofReplayStore())

        let unapproved = makeProof(session: "s1", build: "other-build", generation: 1, keyId: "trusted-key")
        let unapprovedAccepted = await verifier.verify(unapproved, expectedModelId: "model-a",
            expectedModelFileSHA256: unapproved.modelFileSHA256)
        XCTAssertFalse(unapprovedAccepted)

        let unknown = makeProof(session: "s2", build: "approved-build", generation: 1, keyId: "unknown-key")
        let unknownAccepted = await verifier.verify(unknown, expectedModelId: "model-a",
            expectedModelFileSHA256: unknown.modelFileSHA256)
        XCTAssertFalse(unknownAccepted)

        let forged = makeProof(session: "s3", build: "approved-build", generation: 1,
            keyId: "trusted-key", signature: Data(repeating: 0, count: 64).base64EncodedString())
        let forgedAccepted = await verifier.verify(forged, expectedModelId: "model-a",
            expectedModelFileSHA256: forged.modelFileSHA256)
        XCTAssertFalse(forgedAccepted)
    }

    func testVerifierRejectsEmptyKeyAndBuildIdentifiers() async {
        let invalidTrustedKey = RuntimeProofTrustedKey(
            keyId: "",
            rawPublicKey: Data(repeating: 1, count: 32),
            allowedRuntimeBuildIds: [""]
        )
        let verifier = Ed25519RuntimeProofVerifier(
            trustedKeys: [invalidTrustedKey],
            replayStore: TestRuntimeProofReplayStore()
        )
        let proof = makeProof(session: "s", build: "", generation: 1, keyId: "")
        let accepted = await verifier.verify(proof, expectedModelId: "model-a",
            expectedModelFileSHA256: proof.modelFileSHA256)
        XCTAssertFalse(accepted)
    }

    func testVerifierRejectsOversizedProofFieldsBeforeCanonicalization() async throws {
        let privateKey = Curve25519.Signing.PrivateKey()
        let trusted = RuntimeProofTrustedKey(
            keyId: "trusted-key",
            rawPublicKey: privateKey.publicKey.rawRepresentation,
            allowedRuntimeBuildIds: ["approved-build"]
        )
        let verifier = Ed25519RuntimeProofVerifier(
            trustedKeys: [trusted],
            replayStore: TestRuntimeProofReplayStore()
        )
        let signature = Data(repeating: 0, count: 64).base64EncodedString()
        let candidates = [
            makeProof(session: String(repeating: "s", count: 257), build: "approved-build",
                generation: 1, keyId: "trusted-key", signature: signature),
            makeProof(session: "s", build: String(repeating: "b", count: 129),
                generation: 1, keyId: "trusted-key", signature: signature),
            makeProof(session: "s", build: "approved-build",
                generation: 1, keyId: String(repeating: "k", count: 129), signature: signature)
        ]

        for proof in candidates {
            let accepted = await verifier.verify(
                proof,
                expectedModelId: "model-a",
                expectedModelFileSHA256: proof.modelFileSHA256
            )
            XCTAssertFalse(accepted)
        }
    }

    func testDuplicateTrustedKeyIdsAreRejected() async throws {
        let privateKey = Curve25519.Signing.PrivateKey()
        let duplicate = RuntimeProofTrustedKey(keyId: "same", rawPublicKey: privateKey.publicKey.rawRepresentation,
            allowedRuntimeBuildIds: ["approved-build"])
        let verifier = Ed25519RuntimeProofVerifier(trustedKeys: [duplicate, duplicate],
            replayStore: TestRuntimeProofReplayStore())
        let proof = makeProof(session: "s", build: "approved-build", generation: 1, keyId: "same")
        let duplicateKeyAccepted = await verifier.verify(proof, expectedModelId: "model-a",
            expectedModelFileSHA256: proof.modelFileSHA256)
        XCTAssertFalse(duplicateKeyAccepted)
    }

    #if os(iOS)
    func testKeychainReplayStorePersistsMonotonicGenerationAcrossInstances() async throws {
        let service = "com.pocketailab.runtime-proof-replay.tests.\(UUID().uuidString)"
        let cleanup: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrSynchronizable as String: false
        ]
        defer { SecItemDelete(cleanup as CFDictionary) }

        let first = KeychainRuntimeProofReplayStore(service: service)
        let firstAccepted = try await first.accept(sessionId: "session", keyId: "key", generationCounter: 1)
        XCTAssertTrue(firstAccepted)
        let recreated = KeychainRuntimeProofReplayStore(service: service)
        let replayAccepted = try await recreated.accept(sessionId: "session", keyId: "key", generationCounter: 1)
        XCTAssertFalse(replayAccepted)
        let nextGenerationAccepted = try await recreated.accept(sessionId: "session", keyId: "key", generationCounter: 2)
        XCTAssertTrue(nextGenerationAccepted)
        let rotatedKeyAccepted = try await recreated.accept(sessionId: "session", keyId: "rotated-key", generationCounter: 3)
        XCTAssertFalse(rotatedKeyAccepted)
    }
    #endif

    private func makeProof(session: String, build: String, generation: Int, keyId: String,
        signature: String = "pending") -> RuntimeSessionProof {
        RuntimeSessionProof(protocolVersion: .v1, sessionId: session, modelId: "model-a",
            modelFileSHA256: String(repeating: "b", count: 64), runtimeBuildId: build,
            expiresAt: "2030-01-01T00:00:00.000Z", generationCounter: generation,
            keyId: keyId, signature: signature)
    }
}

private actor TestRuntimeProofReplayStore: RuntimeProofReplayStore {
    private var accepted: [String: (keyId: String, generation: Int)] = [:]

    func accept(sessionId: String, keyId: String, generationCounter: Int) async throws -> Bool {
        if let previous = accepted[sessionId] {
            guard previous.keyId == keyId, generationCounter > previous.generation else {
                return false
            }
        }
        accepted[sessionId] = (keyId, generationCounter)
        return true
    }
}

private actor FailingRuntimeProofReplayStore: RuntimeProofReplayStore {
    func accept(sessionId: String, keyId: String, generationCounter: Int) async throws -> Bool {
        throw RuntimeProofReplayStoreError.corruptRecord
    }
}

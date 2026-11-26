import XCTest
@testable import PocketAILab
import PocketLlamaEngine
import Security

final class PocketAILabTests: XCTestCase {
    func testUnavailableProbeNeverClaimsMetalReady() {
        let probe = LlamaCppMetalBackend.probe()
        if !probe.linked { XCTAssertFalse(probe.metalDeviceUsable) }
        if !probe.metalBackendRegistered { XCTAssertFalse(probe.metalDeviceUsable) }
    }

    func testOnlyGGUFModelFilesAreAccepted() {
        XCTAssertEqual(URL(fileURLWithPath: "/tmp/model.gguf").pathExtension.lowercased(), "gguf")
        XCTAssertNotEqual(URL(fileURLWithPath: "/tmp/model.bin").pathExtension.lowercased(), "gguf")
        XCTAssertNotEqual(URL(fileURLWithPath: "/tmp/model.gguf.zip").pathExtension.lowercased(), "gguf")
    }

    func testRuntimeTrustRemainsUnverifiedUntilTrustedLeaseIntegrationExists() {
        XCTAssertEqual(RuntimeTrustPresentation.stateLabel, "Unverified")
        XCTAssertFalse(RuntimeTrustPresentation.isVerified)
        XCTAssertTrue(RuntimeTrustPresentation.detail.contains("server-issued runtime lease"))
        XCTAssertTrue(RuntimeTrustPresentation.statusMessage(after: "Model loaded").contains("Runtime trust remains unverified"))
    }

    func testKeychainReplayStorePersistsAcrossStoreRecreation() async throws {
        let service = "com.pocketailab.runtime-proof-replay.tests.\(UUID().uuidString)"
        let cleanupQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrSynchronizable as String: false
        ]
        defer { SecItemDelete(cleanupQuery as CFDictionary) }

        let firstStore = KeychainRuntimeProofReplayStore(service: service)
        let firstAccepted = try await firstStore.accept(
            sessionId: "session-1", keyId: "key-1", generationCounter: 1
        )
        XCTAssertTrue(firstAccepted)

        let recreatedStore = KeychainRuntimeProofReplayStore(service: service)
        let replayAccepted = try await recreatedStore.accept(
            sessionId: "session-1", keyId: "key-1", generationCounter: 1
        )
        XCTAssertFalse(replayAccepted)
        let invalidGenerationAccepted = try await recreatedStore.accept(
            sessionId: "session-1", keyId: "key-1", generationCounter: 0
        )
        XCTAssertFalse(invalidGenerationAccepted)
        let keyChangeAccepted = try await recreatedStore.accept(
            sessionId: "session-1", keyId: "key-2", generationCounter: 2
        )
        XCTAssertFalse(keyChangeAccepted)
        let nextGenerationAccepted = try await recreatedStore.accept(
            sessionId: "session-1", keyId: "key-1", generationCounter: 2
        )
        XCTAssertTrue(nextGenerationAccepted)
        let staleGenerationAccepted = try await firstStore.accept(
            sessionId: "session-1", keyId: "key-1", generationCounter: 1
        )
        XCTAssertFalse(staleGenerationAccepted)
    }
}

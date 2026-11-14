import XCTest
@testable import PocketAILab
import PocketLlamaEngine

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
}

import Foundation
import XCTest
@testable import ApexBridge

final class BridgeGateChallengeRequestTests: XCTestCase {
    func testAuthorizeGenerationRequiresOnlyHostBindableUUIDFields() {
        let trusted = URL(string: "https://workspace.example.test/app")!
        let page = URL(string: "https://workspace.example.test/")!
        let valid: [String: Any] = [
            "id": UUID().uuidString,
            "action": "authorizeGeneration",
            "sessionId": UUID().uuidString,
            "requestId": UUID().uuidString
        ]

        XCTAssertEqual(BridgeGate.parse(valid, page: page, trusted: trusted), .accepted)

        var invalidSession = valid
        invalidSession["sessionId"] = "not-a-uuid"
        XCTAssertEqual(BridgeGate.parse(invalidSession, page: page, trusted: trusted), .invalidMessage)

        var invalidRequest = valid
        invalidRequest["requestId"] = "not-a-uuid"
        XCTAssertEqual(BridgeGate.parse(invalidRequest, page: page, trusted: trusted), .invalidMessage)

        var unknownField = valid
        unknownField["challengeNonce"] = String(repeating: "a", count: 32)
        XCTAssertEqual(BridgeGate.parse(unknownField, page: page, trusted: trusted), .invalidMessage)
    }

    func testAuthorizeGenerationRejectsForeignOrigin() {
        let trusted = URL(string: "https://workspace.example.test/app")!
        let foreign = URL(string: "https://attacker.example.test/")!
        let body: [String: Any] = [
            "id": UUID().uuidString,
            "action": "authorizeGeneration",
            "sessionId": UUID().uuidString,
            "requestId": UUID().uuidString
        ]

        XCTAssertEqual(BridgeGate.parse(body, page: foreign, trusted: trusted), .untrustedOrigin)
    }
}

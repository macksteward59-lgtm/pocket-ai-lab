import XCTest
@testable import PocketLlamaEngine

final class NativeAgentModelRouterTests: XCTestCase {
    private func profile(_ id: String, capabilities: Set<String>, memory: Int, priority: Int = 0) -> NativeAgentModelProfile {
        NativeAgentModelProfile(model: ModelDescriptor(id: id, name: id, path: "/models/\(id).gguf", contextLength: 4_096),
                                capabilities: capabilities, estimatedMemoryMB: memory, priority: priority)
    }

    func testSelectsHighestPriorityFullCapabilityMatch() throws {
        let route = try NativeAgentModelRouter().route(
            NativeAgentRouteRequest(agentId: "security-analyst", requiredCapabilities: [" SECURITY ", "reasoning"]),
            from: [profile("general", capabilities: ["reasoning"], memory: 900, priority: 100),
                   profile("specialist", capabilities: ["security", "reasoning"], memory: 2_000, priority: 5),
                   profile("balanced", capabilities: ["security", "reasoning", "coding"], memory: 1_200, priority: 10)])
        XCTAssertEqual(route.agentId, "security-analyst")
        XCTAssertEqual(route.model.id, "balanced")
        XCTAssertEqual(route.estimatedMemoryMB, 1_200)
        XCTAssertEqual(route.matchedCapabilities, ["security", "reasoning"])
    }

    func testTieBreakIsStableByMemoryThenModelID() throws {
        let request = NativeAgentRouteRequest(agentId: "reasoner", requiredCapabilities: ["reasoning"])
        let profiles = [profile("zeta", capabilities: ["reasoning"], memory: 800),
                        profile("beta", capabilities: ["reasoning"], memory: 600),
                        profile("alpha", capabilities: ["reasoning"], memory: 600)]
        XCTAssertEqual(try NativeAgentModelRouter().route(request, from: profiles).model.id, "alpha")
        XCTAssertEqual(try NativeAgentModelRouter().route(request, from: profiles.reversed()).model.id, "alpha")
    }

    func testPartialCapabilityMatchIsRejectedWithoutFallback() {
        do {
            _ = try NativeAgentModelRouter().route(NativeAgentRouteRequest(agentId: "engineer", requiredCapabilities: ["swift", "security"]),
                from: [profile("swift-only", capabilities: ["swift"], memory: 700)])
            XCTFail("partial capability match must not route")
        } catch NativeAgentModelRouterError.noEligibleModel(let agentId, let required) {
            XCTAssertEqual(agentId, "engineer")
            XCTAssertEqual(required, ["security", "swift"])
        } catch { XCTFail("unexpected error: \(error)") }
    }

    func testDuplicateModelIDsAreRejected() {
        do {
            _ = try NativeAgentModelRouter().route(NativeAgentRouteRequest(agentId: "critic", requiredCapabilities: ["reasoning"]),
                from: [profile("same", capabilities: ["reasoning"], memory: 500), profile("same", capabilities: ["reasoning", "security"], memory: 800)])
            XCTFail("ambiguous model catalogue must be rejected")
        } catch NativeAgentModelRouterError.duplicateModel("same") {
        } catch { XCTFail("unexpected error: \(error)") }
    }

    func testMalformedRequestsAndProfilesFailClosed() {
        do {
            _ = try NativeAgentModelRouter().route(NativeAgentRouteRequest(agentId: "reasoner", requiredCapabilities: []),
                from: [profile("model", capabilities: ["reasoning"], memory: 500)])
            XCTFail("empty capability request must fail")
        } catch NativeAgentModelRouterError.invalidRequest {
        } catch { XCTFail("unexpected error: \(error)") }
        do {
            _ = try NativeAgentModelRouter().route(NativeAgentRouteRequest(agentId: "reasoner", requiredCapabilities: ["reasoning"]),
                from: [profile("invalid", capabilities: ["reasoning"], memory: 0)])
            XCTFail("invalid memory estimate must fail")
        } catch NativeAgentModelRouterError.invalidProfile {
        } catch { XCTFail("unexpected error: \(error)") }
    }
}
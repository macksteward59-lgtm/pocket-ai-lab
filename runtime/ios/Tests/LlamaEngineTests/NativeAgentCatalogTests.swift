import XCTest
@testable import PocketLlamaEngine

final class NativeAgentCatalogTests: XCTestCase {
    func testDefinesEightPermanentCoreRolesInCanonicalOrder() {
        let catalog = NativeAgentCatalog()
        let plan = catalog.corePlan()
        XCTAssertEqual(plan.map(\.agentId), [
            "director", "reasoner", "researcher", "engineer",
            "security-analyst", "critic", "validator", "archivist"
        ])
        XCTAssertEqual(plan.count, NativeAgentCatalog.maximumPlanSize)
        XCTAssertTrue(plan.allSatisfy { !$0.requiredCapabilities.isEmpty && !$0.instructions.isEmpty })
    }

    func testSpecialistTemplatesAreAvailableButNotAutomaticallyInserted() {
        let catalog = NativeAgentCatalog()
        XCTAssertEqual(NativeAgentCatalog.specialistTemplates.count, 8)
        XCTAssertEqual(catalog.corePlan().count, 8)
        XCTAssertFalse(catalog.corePlan().contains { $0.agentId.hasPrefix("specialist.") })
    }

    func testKnownSpecialistCanBeInstantiatedWithTaskScopedIdentity() throws {
        let catalog = NativeAgentCatalog()
        let step = try catalog.instantiateSpecialist(templateID: "swift-ios", instanceID: "task-42")
        XCTAssertEqual(step.agentId, "specialist.swift-ios.task-42")
        XCTAssertEqual(step.requiredCapabilities, ["engineering", "swift", "ios"])
    }

    func testSpecialistInstanceIdentityIsValidated() {
        let catalog = NativeAgentCatalog()
        XCTAssertThrowsError(try catalog.instantiateSpecialist(templateID: "swift-ios", instanceID: "../other")) { error in
            XCTAssertEqual(error as? NativeAgentCatalogError, .invalidInstanceID)
        }
    }

    func testPermanentRoleCannotBeInstantiatedAsSpecialist() {
        let catalog = NativeAgentCatalog()
        XCTAssertThrowsError(try catalog.instantiateSpecialist(templateID: "director", instanceID: "task-1")) { error in
            XCTAssertEqual(error as? NativeAgentCatalogError, .unknownAgent("director"))
        }
    }

    func testPlanRejectsUnknownDuplicateAndExcessRoles() {
        let catalog = NativeAgentCatalog()
        XCTAssertThrowsError(try catalog.plan(agentIDs: ["unknown"])) { error in
            XCTAssertEqual(error as? NativeAgentCatalogError, .unknownAgent("unknown"))
        }
        XCTAssertThrowsError(try catalog.plan(agentIDs: ["reasoner", "reasoner"])) { error in
            XCTAssertEqual(error as? NativeAgentCatalogError, .duplicateAgent("reasoner"))
        }
        XCTAssertThrowsError(try catalog.plan(agentIDs: Array(repeating: "reasoner", count: 9)))
        XCTAssertThrowsError(try catalog.plan(agentIDs: []))
    }

    func testSpecialistCanReplaceCoreRoleWithinEightStepBound() throws {
        let catalog = NativeAgentCatalog()
        let plan = try catalog.plan(agentIDs: [
            "director", "reasoner", "researcher", "swift-ios",
            "security-analyst", "critic", "validator", "archivist"
        ])
        XCTAssertEqual(plan.count, 8)
        XCTAssertEqual(plan[3].agentId, "swift-ios")
        XCTAssertEqual(plan[3].requiredCapabilities, ["engineering", "swift", "ios"])
    }
}

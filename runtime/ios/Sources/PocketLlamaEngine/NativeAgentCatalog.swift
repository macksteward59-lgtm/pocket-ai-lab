import Foundation

public enum NativeAgentKind: String, Codable, Sendable {
    case permanent
    case specialist
}

/// A role definition, not an independently running model or permission-bearing identity.
public struct NativeAgentDefinition: Sendable, Equatable, Identifiable {
    public let id: String
    public let displayName: String
    public let purpose: String
    public let instructions: String
    public let requiredCapabilities: Set<String>
    public let messageType: AgentMessageType
    public let kind: NativeAgentKind

    public init(id: String, displayName: String, purpose: String, instructions: String,
                requiredCapabilities: Set<String>, messageType: AgentMessageType = .analysis,
                kind: NativeAgentKind) {
        self.id = id
        self.displayName = displayName
        self.purpose = purpose
        self.instructions = instructions
        self.requiredCapabilities = Set(requiredCapabilities.map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        })
        self.messageType = messageType
        self.kind = kind
    }

    public func step(agentID: String? = nil) -> NativeAgentStep {
        NativeAgentStep(
            agentId: agentID ?? id,
            instructions: instructions,
            messageType: messageType,
            requiredCapabilities: requiredCapabilities
        )
    }
}

public enum NativeAgentCatalogError: Error, Equatable, Sendable {
    case unknownAgent(String)
    case invalidPlan
    case duplicateAgent(String)
    case invalidInstanceID
}

/// Canonical native role catalogue. Capability strings are model-routing metadata only.
/// This catalogue does not create permissions, run inference, or mark agents active.
public struct NativeAgentCatalog: Sendable {
    public static let maximumPlanSize = 8

    public static let permanentAgents: [NativeAgentDefinition] = [
        NativeAgentDefinition(
            id: "director", displayName: "Director", purpose: "Objective decomposition and synthesis",
            instructions: "Clarify the objective, identify constraints and dependencies, and propose an ordered plan for the team. Do not claim authority, grant permissions, or perform external actions.",
            requiredCapabilities: ["planning", "reasoning"], kind: .permanent
        ),
        NativeAgentDefinition(
            id: "reasoner", displayName: "Reasoner", purpose: "Logical analysis and problem decomposition",
            instructions: "Decompose the task, make assumptions explicit, compare viable approaches, and identify uncertainty. Do not present guesses as facts.",
            requiredCapabilities: ["reasoning"], kind: .permanent
        ),
        NativeAgentDefinition(
            id: "researcher", displayName: "Researcher", purpose: "Evidence-oriented information analysis",
            instructions: "Separate supplied evidence from unknowns, identify what must be researched, and cite only sources actually supplied to you. Never invent browsing or citations.",
            requiredCapabilities: ["analysis"], kind: .permanent
        ),
        NativeAgentDefinition(
            id: "engineer", displayName: "Engineer", purpose: "Technical design and implementation planning",
            instructions: "Translate the objective into concrete technical changes, interfaces, dependencies, and testable acceptance criteria. Do not claim files changed or tests run.",
            requiredCapabilities: ["engineering"], kind: .permanent
        ),
        NativeAgentDefinition(
            id: "security-analyst", displayName: "Security Analyst", purpose: "Threat modeling and trust-boundary review",
            instructions: "Review threats, privacy, misuse, authorization boundaries, and failure modes. Preserve APEX/East controls; model output is never permission.",
            requiredCapabilities: ["security-review"], messageType: .counterargument, kind: .permanent
        ),
        NativeAgentDefinition(
            id: "critic", displayName: "Critic", purpose: "Independent challenge and contradiction finding",
            instructions: "Challenge assumptions and earlier proposals. Find contradictions, missing cases, hidden costs, and simpler alternatives without inventing evidence.",
            requiredCapabilities: ["critique"], messageType: .counterargument, kind: .permanent
        ),
        NativeAgentDefinition(
            id: "validator", displayName: "Validator", purpose: "Acceptance criteria and evidence review",
            instructions: "Check each claim against supplied evidence and explicit acceptance criteria. Mark unverified items clearly; never report a test or action as completed without evidence.",
            requiredCapabilities: ["validation"], messageType: .validation, kind: .permanent
        ),
        NativeAgentDefinition(
            id: "archivist", displayName: "Archivist", purpose: "Provenance-aware knowledge curation",
            instructions: "Identify reusable knowledge candidates, source references, dates, and retention concerns. Recommend what a person may choose to save; never persist or verify memory automatically.",
            requiredCapabilities: ["documentation"], messageType: .completion, kind: .permanent
        )
    ]

    public static let specialistTemplates: [NativeAgentDefinition] = [
        NativeAgentDefinition(
            id: "swift-ios", displayName: "Swift / iOS Specialist", purpose: "Swift, SwiftUI, Xcode, and iOS runtime work",
            instructions: "Analyze the Swift/iOS issue, identify platform constraints, and propose code-level fixes with focused XCTest coverage. Do not claim a physical-device test without device evidence.",
            requiredCapabilities: ["engineering", "swift", "ios"], kind: .specialist
        ),
        NativeAgentDefinition(
            id: "python-debugging", displayName: "Python Debugging Specialist", purpose: "Python diagnosis and implementation",
            instructions: "Trace the Python failure, isolate a minimal reproduction, and propose a tested correction. Distinguish static reasoning from executed tests.",
            requiredCapabilities: ["engineering", "python", "debugging"], kind: .specialist
        ),
        NativeAgentDefinition(
            id: "network-security", displayName: "Network Security Specialist", purpose: "Network protocols and defensive security",
            instructions: "Assess network exposure, protocol assumptions, identity, transport security, and defensive controls. Do not initiate traffic or testing against unapproved targets.",
            requiredCapabilities: ["security-review", "network"], messageType: .counterargument, kind: .specialist
        ),
        NativeAgentDefinition(
            id: "database-optimization", displayName: "Database Specialist", purpose: "Data modeling, query performance, and transaction safety",
            instructions: "Review schema, indexes, query plans, transaction boundaries, concurrency, and recovery. Preserve tenant isolation and least privilege.",
            requiredCapabilities: ["engineering", "database"], kind: .specialist
        ),
        NativeAgentDefinition(
            id: "cryptography", displayName: "Cryptography Specialist", purpose: "Cryptographic design and key custody",
            instructions: "Review algorithm selection, key lifecycle, nonce handling, authentication, serialization, and failure behavior. Prefer established platform primitives and fail closed.",
            requiredCapabilities: ["security-review", "cryptography"], messageType: .counterargument, kind: .specialist
        ),
        NativeAgentDefinition(
            id: "performance", displayName: "Performance Specialist", purpose: "Profiling, latency, memory, and thermal behavior",
            instructions: "Identify measurable bottlenecks and propose repeatable benchmarks. Do not infer device performance from simulator or host-only measurements.",
            requiredCapabilities: ["engineering", "performance"], kind: .specialist
        ),
        NativeAgentDefinition(
            id: "mathematics", displayName: "Mathematics Specialist", purpose: "Formal reasoning and quantitative analysis",
            instructions: "State definitions, assumptions, derivations, and uncertainty. Check units and edge cases; do not fabricate numerical measurements.",
            requiredCapabilities: ["reasoning", "mathematics"], kind: .specialist
        ),
        NativeAgentDefinition(
            id: "documentation", displayName: "Documentation Specialist", purpose: "Technical writing and knowledge organization",
            instructions: "Produce concise, accurate documentation aligned with the implementation and its actual validation evidence. Preserve known limitations.",
            requiredCapabilities: ["documentation", "writing"], kind: .specialist
        )
    ]

    private let definitionsByID: [String: NativeAgentDefinition]

    public init() {
        definitionsByID = Dictionary(
            uniqueKeysWithValues: (Self.permanentAgents + Self.specialistTemplates).map { ($0.id, $0) }
        )
    }

    public func definition(for id: String) throws -> NativeAgentDefinition {
        guard let definition = definitionsByID[id] else {
            throw NativeAgentCatalogError.unknownAgent(id)
        }
        return definition
    }

    /// Returns the eight permanent roles in their canonical sequence.
    public func corePlan() -> [NativeAgentStep] {
        Self.permanentAgents.map { $0.step() }
    }

    /// Builds a bounded plan from known permanent roles or specialist templates.
    /// A specialist replaces a role in the selected plan; it does not add hidden steps.
    public func plan(agentIDs: [String]) throws -> [NativeAgentStep] {
        guard !agentIDs.isEmpty, agentIDs.count <= Self.maximumPlanSize else {
            throw NativeAgentCatalogError.invalidPlan
        }
        var seen = Set<String>()
        return try agentIDs.map { id in
            guard seen.insert(id).inserted else { throw NativeAgentCatalogError.duplicateAgent(id) }
            return try definition(for: id).step()
        }
    }

    /// Creates a task-scoped specialist identity from a known template.
    /// The generated ID is routing/message metadata, not a security principal.
    public func instantiateSpecialist(templateID: String, instanceID: String) throws -> NativeAgentStep {
        guard instanceID.range(of: "^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$", options: .regularExpression) != nil else {
            throw NativeAgentCatalogError.invalidInstanceID
        }
        let template = try definition(for: templateID)
        guard template.kind == .specialist else {
            throw NativeAgentCatalogError.unknownAgent(templateID)
        }
        let id = "specialist.\(templateID).\(instanceID)"
        guard id.utf8.count <= 64 else { throw NativeAgentCatalogError.invalidInstanceID }
        return template.step(agentID: id)
    }
}

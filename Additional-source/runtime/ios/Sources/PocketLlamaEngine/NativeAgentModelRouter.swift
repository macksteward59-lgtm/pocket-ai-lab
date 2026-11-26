import Foundation

/// A locally available model plus the capabilities it is approved to serve.
/// Capability labels are routing metadata, not permissions or evidence of execution.
public struct NativeAgentModelProfile: Sendable, Equatable {
    public let model: ModelDescriptor
    public let capabilities: Set<String>
    public let estimatedMemoryMB: Int
    public let priority: Int

    public init(model: ModelDescriptor, capabilities: Set<String>, estimatedMemoryMB: Int, priority: Int = 0) {
        self.model = model
        self.capabilities = Set(capabilities.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
        self.estimatedMemoryMB = estimatedMemoryMB
        self.priority = priority
    }
}

public struct NativeAgentRouteRequest: Sendable, Equatable {
    public let agentId: String
    public let requiredCapabilities: Set<String>

    public init(agentId: String, requiredCapabilities: Set<String>) {
        self.agentId = agentId
        self.requiredCapabilities = Set(requiredCapabilities.map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() })
    }
}

public struct NativeAgentModelRoute: Sendable, Equatable {
    public let agentId: String
    public let model: ModelDescriptor
    public let estimatedMemoryMB: Int
    public let matchedCapabilities: Set<String>
}

public enum NativeAgentModelRouterError: Error, Equatable, Sendable {
    case invalidRequest(String)
    case invalidProfile(String)
    case duplicateModel(String)
    case noEligibleModel(agentId: String, requiredCapabilities: [String])
}

/// Deterministic, offline-first route selection over an explicit local model catalogue.
/// This selects candidates only; it does not load models or authorize actions.
public struct NativeAgentModelRouter: Sendable {
    public init() {}

    public func route(_ request: NativeAgentRouteRequest, from profiles: [NativeAgentModelProfile]) throws -> NativeAgentModelRoute {
        let agentId = request.agentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !agentId.isEmpty, agentId.utf8.count <= 64,
              !request.requiredCapabilities.isEmpty, request.requiredCapabilities.count <= 16,
              request.requiredCapabilities.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 64 }) else {
            throw NativeAgentModelRouterError.invalidRequest(agentId)
        }
        guard !profiles.isEmpty, profiles.count <= 64 else {
            throw NativeAgentModelRouterError.invalidRequest("profile catalogue must contain 1...64 entries")
        }
        var seen = Set<String>()
        for profile in profiles {
            let modelId = profile.model.id.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !modelId.isEmpty, modelId.utf8.count <= 128, profile.estimatedMemoryMB > 0,
                  profile.model.contextLength > 0, !profile.capabilities.isEmpty,
                  profile.capabilities.count <= 32,
                  profile.capabilities.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 64 }) else {
                throw NativeAgentModelRouterError.invalidProfile(profile.model.id)
            }
            guard seen.insert(modelId).inserted else { throw NativeAgentModelRouterError.duplicateModel(modelId) }
        }
        let eligible = profiles.filter { request.requiredCapabilities.isSubset(of: $0.capabilities) }
        guard let selected = eligible.sorted(by: Self.precedes).first else {
            throw NativeAgentModelRouterError.noEligibleModel(agentId: agentId, requiredCapabilities: request.requiredCapabilities.sorted())
        }
        return NativeAgentModelRoute(agentId: agentId, model: selected.model,
                                     estimatedMemoryMB: selected.estimatedMemoryMB,
                                     matchedCapabilities: request.requiredCapabilities)
    }

    private static func precedes(_ lhs: NativeAgentModelProfile, _ rhs: NativeAgentModelProfile) -> Bool {
        if lhs.priority != rhs.priority { return lhs.priority > rhs.priority }
        if lhs.estimatedMemoryMB != rhs.estimatedMemoryMB { return lhs.estimatedMemoryMB < rhs.estimatedMemoryMB }
        return lhs.model.id < rhs.model.id
    }
}
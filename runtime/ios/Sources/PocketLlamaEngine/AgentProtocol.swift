import Foundation

/// Wire-compatible contracts shared with packages/intelligence/contracts/AgentProtocol.ts.
/// These types carry proposals and runtime claims only; they do not authorize actions.
public struct AgentTaskRequest: Codable, Sendable, Equatable {
    public let protocolVersion: Int
    public let id: String
    public let objective: String
    public let requiredCapabilities: [String]

    public init(protocolVersion: Int = 1, id: String, objective: String, requiredCapabilities: [String]) {
        self.protocolVersion = protocolVersion
        self.id = id
        self.objective = objective
        self.requiredCapabilities = requiredCapabilities
    }
}

public enum AgentMessageType: String, Codable, Sendable {
    case taskAssignment = "task_assignment"
    case analysis
    case question
    case evidence
    case counterargument
    case revision
    case validation
    case completion
    case securityBoundaryViolation = "security_boundary_violation"
}

public indirect enum AgentJSONValue: Codable, Sendable, Equatable {
    case string(String)
    case integer(Int)
    case number(Double)
    case boolean(Bool)
    case object([String: AgentJSONValue])
    case array([AgentJSONValue])
    case null

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null; return }
        if let value = try? container.decode(Bool.self) { self = .boolean(value); return }
        if let value = try? container.decode(Int.self) { self = .integer(value); return }
        if let value = try? container.decode(Double.self) { self = .number(value); return }
        if let value = try? container.decode(String.self) { self = .string(value); return }
        if let value = try? container.decode([String: AgentJSONValue].self) { self = .object(value); return }
        if let value = try? container.decode([AgentJSONValue].self) { self = .array(value); return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .integer(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .boolean(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

public struct AgentMessageEnvelope: Codable, Sendable, Equatable {
    public let protocolVersion: Int
    public let messageId: UUID
    public let taskId: String
    public let conversationId: String
    public let senderAgentId: String
    public let recipientAgentId: String
    public let messageType: AgentMessageType
    public let payload: AgentJSONValue
    public let evidenceRefs: [String]
    public let parentMessageId: UUID?
    public let createdAt: String
    public let sequence: Int

    public init(protocolVersion: Int = 1, messageId: UUID, taskId: String, conversationId: String,
                senderAgentId: String, recipientAgentId: String,
                messageType: AgentMessageType, payload: AgentJSONValue,
                evidenceRefs: [String] = [], parentMessageId: UUID? = nil,
                createdAt: String, sequence: Int) {
        self.protocolVersion = protocolVersion
        self.messageId = messageId
        self.taskId = taskId
        self.conversationId = conversationId
        self.senderAgentId = senderAgentId
        self.recipientAgentId = recipientAgentId
        self.messageType = messageType
        self.payload = payload
        self.evidenceRefs = evidenceRefs
        self.parentMessageId = parentMessageId
        self.createdAt = createdAt
        self.sequence = sequence
    }
}

public enum RuntimeReadinessState: String, Codable, Sendable {
    case unavailable
    case loading
    case ready
    case expired
}

/// Runtime-signed claim. Its presence is not proof until RuntimeProofVerifier authenticates it.
public struct RuntimeSessionProof: Codable, Sendable, Equatable {
    public let protocolVersion: Int
    public let sessionId: String
    public let modelId: String
    public let modelFileSHA256: String
    public let runtimeBuildId: String
    public let expiresAt: String
    public let generationCounter: Int
    public let keyId: String
    public let signature: String
    public let algorithm: String

    public init(protocolVersion: Int = 1, sessionId: String, modelId: String, modelFileSHA256: String,
                runtimeBuildId: String, expiresAt: String, generationCounter: Int,
                keyId: String, signature: String, algorithm: String = "Ed25519") {
        self.protocolVersion = protocolVersion
        self.sessionId = sessionId
        self.modelId = modelId
        self.modelFileSHA256 = modelFileSHA256
        self.runtimeBuildId = runtimeBuildId
        self.expiresAt = expiresAt
        self.generationCounter = generationCounter
        self.keyId = keyId
        self.signature = signature
        self.algorithm = algorithm
    }
}

public protocol RuntimeProofVerifier: Sendable {
    func verify(_ proof: RuntimeSessionProof, expectedModelId: String,
                expectedModelFileSHA256: String) async -> Bool
}

/// Fails closed unless an independently implemented verifier authenticates the runtime claim.
public enum RuntimeReadinessEvaluator {
    private static func parseISO8601(_ value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    public static func evaluate(_ proof: RuntimeSessionProof?,
                                expectedModelId: String,
                                expectedModelFileSHA256: String,
                                verifier: RuntimeProofVerifier,
                                now: Date = Date()) async -> RuntimeReadinessState {
        guard let proof else { return .unavailable }
        guard proof.algorithm == "Ed25519",
              proof.generationCounter > 0,
              proof.modelFileSHA256.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil,
              !proof.sessionId.isEmpty, !proof.runtimeBuildId.isEmpty,
              !proof.keyId.isEmpty, !proof.signature.isEmpty,
              let expiry = Self.parseISO8601(proof.expiresAt) else {
            return .unavailable
        }
        guard expiry > now else { return .expired }
        guard proof.modelId == expectedModelId,
              proof.modelFileSHA256.lowercased() == expectedModelFileSHA256.lowercased() else {
            return .unavailable
        }
        return await verifier.verify(proof, expectedModelId: expectedModelId,
                                     expectedModelFileSHA256: expectedModelFileSHA256) ? .ready : .unavailable
    }
}

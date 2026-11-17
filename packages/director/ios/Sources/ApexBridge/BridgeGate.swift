import Foundation

public enum BridgeDecision: Equatable, Sendable {
    case accepted
    case untrustedOrigin
    case invalidMessage
    case authorizationRequired
}

/// Validates WebKit messages before they can reach the native runtime.
/// Origin comparison follows the scheme/host/effective-port tuple and permits
/// cleartext HTTP only for loopback development.
public enum BridgeGate {
    private static let allowed: [String: Set<String>] = [
        "getRuntimeStatus": ["id", "action"],
        "listModels": ["id", "action"],
        "importModel": ["id", "action", "model", "artifactId"],
        "validateModel": ["id", "action", "model"],
        "loadModel": ["id", "action", "model"],
        "checkReadiness": ["id", "action", "sessionId"],
        "authorizeGeneration": ["id", "action", "sessionId", "requestId"],
        "generate": ["id", "action", "sessionId", "prompt", "requestId", "conversationRequestId", "attemptId", "challengeNonce", "maxTokens", "temperature"],
        "cancelGeneration": ["id", "action", "sessionId", "requestId"],
        "unloadModel": ["id", "action", "sessionId"]
    ]

    private static let required: [String: Set<String>] = [
        "getRuntimeStatus": ["id", "action"],
        "listModels": ["id", "action"],
        "importModel": ["id", "action", "model", "artifactId"],
        "validateModel": ["id", "action", "model"],
        "loadModel": ["id", "action", "model"],
        "checkReadiness": ["id", "action", "sessionId"],
        "authorizeGeneration": ["id", "action", "sessionId", "requestId"],
        "generate": ["id", "action", "sessionId", "prompt", "requestId", "conversationRequestId", "attemptId", "challengeNonce"],
        "cancelGeneration": ["id", "action", "sessionId", "requestId"],
        "unloadModel": ["id", "action", "sessionId"]
    ]

    private static let consequential: Set<String> = ["importModel", "loadModel", "unloadModel"]

    public static func sameOrigin(_ page: URL, trusted: URL) -> Bool {
        guard let pageOrigin = origin(page), let trustedOrigin = origin(trusted) else { return false }
        return pageOrigin == trustedOrigin
    }

    public static func parse(
        _ body: [String: Any],
        page: URL?,
        trusted: URL
    ) -> BridgeDecision {
        guard let page, sameOrigin(page, trusted: trusted) else { return .untrustedOrigin }
        guard let action = body["action"] as? String,
              let allowedKeys = allowed[action],
              let requiredKeys = required[action] else { return .invalidMessage }

        let suppliedKeys = Set(body.keys)
        guard suppliedKeys.isSubset(of: allowedKeys), requiredKeys.isSubset(of: suppliedKeys) else {
            return .invalidMessage
        }
        guard let id = body["id"] as? String, validToken(id, maxBytes: 80) else {
            return .invalidMessage
        }
        // Consequential actions are denied by the parser itself. A Boolean
        // supplied by a caller is not a native approval capability. A future
        // host-owned approval coordinator must authorize these actions through
        // a separate, parameter-bound, one-use mechanism.
        if consequential.contains(action) {
            return .authorizationRequired
        }

        switch action {
        case "importModel":
            guard let model = body["model"] as? String, validToken(model, maxBytes: 128),
                  let artifactId = body["artifactId"] as? String, validToken(artifactId, maxBytes: 128) else {
                return .invalidMessage
            }
        case "validateModel":
            guard let model = body["model"] as? String, validToken(model, maxBytes: 128) else {
                return .invalidMessage
            }
        case "loadModel":
            guard let model = body["model"] as? String, validToken(model, maxBytes: 128) else {
                return .invalidMessage
            }
        case "checkReadiness", "unloadModel":
            guard let sessionId = body["sessionId"] as? String, validUUID(sessionId) else {
                return .invalidMessage
            }
        case "authorizeGeneration":
            guard let sessionId = body["sessionId"] as? String, validUUID(sessionId),
                  let requestId = body["requestId"] as? String, validUUID(requestId) else {
                return .invalidMessage
            }
        case "cancelGeneration":
            guard let sessionId = body["sessionId"] as? String, validUUID(sessionId),
                  let requestId = body["requestId"] as? String, validUUID(requestId) else {
                return .invalidMessage
            }
        case "generate":
            guard let sessionId = body["sessionId"] as? String, validUUID(sessionId),
                  let prompt = body["prompt"] as? String,
                  !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  prompt.utf8.count <= 32_768,
                  let requestId = body["requestId"] as? String, validUUID(requestId),
                  let conversationRequestId = body["conversationRequestId"] as? String,
                  validToken(conversationRequestId, maxBytes: 128),
                  let attemptId = body["attemptId"] as? String, validToken(attemptId, maxBytes: 128),
                  let nonce = body["challengeNonce"] as? String, validToken(nonce, minBytes: 16, maxBytes: 128) else {
                return .invalidMessage
            }
            if let maxTokens = body["maxTokens"] {
                guard let value = maxTokens as? Int, (1...32_768).contains(value) else { return .invalidMessage }
            }
            if let temperature = body["temperature"] {
                guard let value = temperature as? Double, value.isFinite, (0...2).contains(value) else {
                    return .invalidMessage
                }
            }
        default:
            break
        }
        return .accepted
    }

    private static func origin(_ url: URL) -> Origin? {
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let scheme = components.scheme?.lowercased(),
              let rawHost = components.host?.lowercased(),
              components.user == nil, components.password == nil else { return nil }
        let host = rawHost.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !host.isEmpty, scheme == "https" || scheme == "http" else { return nil }
        if scheme == "http", !isLoopback(host) { return nil }
        let port = components.port ?? (scheme == "https" ? 443 : 80)
        guard (1...65_535).contains(port) else { return nil }
        return Origin(scheme: scheme, host: host, port: port)
    }

    private static func isLoopback(_ host: String) -> Bool {
        let normalized = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased()
        return normalized == "localhost" || normalized == "127.0.0.1" || normalized == "::1"
    }

    private static func validUUID(_ value: String) -> Bool {
        UUID(uuidString: value) != nil
    }

    private static func validToken(_ value: String, minBytes: Int = 1, maxBytes: Int) -> Bool {
        let bytes = value.utf8
        guard (minBytes...maxBytes).contains(bytes.count) else { return false }
        return bytes.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte) ||
            [45, 46, 95, 58, 43, 47, 61].contains(byte)
        }
    }

    private struct Origin: Equatable {
        let scheme: String
        let host: String
        let port: Int
    }
}

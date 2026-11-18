import Foundation

public enum BridgeChallengeError: Error, Equatable, Sendable {
    case untrustedOrigin
    case invalidBinding
    case invalidLifetime
}

/// Host-owned, one-use challenge registry for WebKit generation requests.
///
/// The page can receive a nonce, but it cannot mint one or extend its lifetime.
/// A challenge is bound to the trusted origin, request UUID, and runtime session.
/// The WebKit message handler must consume it before dispatching generation.
/// Minimal host-owned challenge-consumption contract. The controller
/// depends on consumption only; issuance remains exclusively on the host store.
public protocol BridgeChallengeConsuming: Sendable {
    func consume(
        _ nonce: String,
        page: URL,
        trusted: URL,
        requestId: String,
        sessionId: String
    ) async -> Bool
}

public actor BridgeChallengeStore: BridgeChallengeConsuming {
    private struct Entry: Sendable {
        let origin: Origin
        let requestId: String
        let sessionId: String
        let expiresAt: Date
    }

    private struct Origin: Equatable, Sendable {
        let scheme: String
        let host: String
        let port: Int

        init?(_ url: URL) {
            guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  let scheme = components.scheme?.lowercased(),
                  let host = components.host?.lowercased(),
                  components.user == nil, components.password == nil else { return nil }
            self.scheme = scheme
            self.host = host
            self.port = components.port ?? (scheme == "https" ? 443 : 80)
        }
    }

    private var entries: [String: Entry] = [:]
    private let lifetime: TimeInterval
    private let clock: @Sendable () -> Date

    public init(
        lifetime: TimeInterval = 60,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) throws {
        guard lifetime.isFinite, (1...300).contains(lifetime) else {
            throw BridgeChallengeError.invalidLifetime
        }
        self.lifetime = lifetime
        self.clock = clock
    }

    /// Called only by the native host when it is ready to authorize one request.
    public func issue(
        page: URL,
        trusted: URL,
        requestId: String,
        sessionId: String
    ) throws -> String {
        guard BridgeGate.sameOrigin(page, trusted: trusted),
              let origin = Origin(page) else {
            throw BridgeChallengeError.untrustedOrigin
        }
        guard let canonicalRequestId = Self.canonicalUUID(requestId),
              let canonicalSessionId = Self.canonicalUUID(sessionId) else {
            throw BridgeChallengeError.invalidBinding
        }

        let nonce = Self.randomNonce()
        entries[nonce] = Entry(
            origin: origin,
            requestId: canonicalRequestId,
            sessionId: canonicalSessionId,
            expiresAt: clock().addingTimeInterval(lifetime)
        )
        return nonce
    }

    /// Consumes a matching challenge exactly once. Failed binding attempts do not
    /// consume another request's challenge; expired challenges are discarded.
    public func consume(
        _ nonce: String,
        page: URL,
        trusted: URL,
        requestId: String,
        sessionId: String
    ) -> Bool {
        guard BridgeGate.sameOrigin(page, trusted: trusted),
              let origin = Origin(page),
              let canonicalRequestId = Self.canonicalUUID(requestId),
              let canonicalSessionId = Self.canonicalUUID(sessionId),
              var entry = entries[nonce] else { return false }

        guard entry.expiresAt > clock() else {
            entries.removeValue(forKey: nonce)
            return false
        }
        guard entry.origin == origin,
              entry.requestId == canonicalRequestId,
              entry.sessionId == canonicalSessionId else { return false }

        entries.removeValue(forKey: nonce)
        return true
    }

    /// Removes challenges bound to the exact spent request identity.
    public func invalidate(requestId: String, sessionId: String) {
        guard let canonicalRequestId = Self.canonicalUUID(requestId),
              let canonicalSessionId = Self.canonicalUUID(sessionId) else { return }
        entries = entries.filter {
            $0.value.requestId != canonicalRequestId || $0.value.sessionId != canonicalSessionId
        }
    }

    public func invalidateAll() {
        entries.removeAll()
    }

    private static func canonicalUUID(_ value: String) -> String? {
        UUID(uuidString: value)?.uuidString
    }

    private static func validUUID(_ value: String) -> Bool {
        canonicalUUID(value) != nil
    }

    private static func randomNonce() -> String {
        var generator = SystemRandomNumberGenerator()
        return (0..<32).map { _ in
            String(format: "%02x", UInt8.random(in: .min ... .max, using: &generator))
        }.joined()
    }
}

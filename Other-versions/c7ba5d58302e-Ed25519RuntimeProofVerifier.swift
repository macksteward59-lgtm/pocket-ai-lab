import CryptoKit
import Foundation

/// A public key provisioned by a trusted host. Model output and proof contents
/// must never be allowed to add or replace entries in this registry.
public struct RuntimeProofTrustedKey: Sendable {
    public let keyId: String
    public let rawPublicKey: Data
    public let allowedRuntimeBuildIds: Set<String>

    public init(keyId: String, rawPublicKey: Data, allowedRuntimeBuildIds: Set<String>) {
        self.keyId = keyId
        self.rawPublicKey = rawPublicKey
        self.allowedRuntimeBuildIds = allowedRuntimeBuildIds
    }
}

/// Stable, unambiguous signing representation shared with the TypeScript contract.
/// Each UTF-8 field is prefixed by a 4-byte unsigned big-endian byte length.
public enum RuntimeSessionProofCanonicalizer {
    public static func canonicalPayload(_ proof: RuntimeSessionProof) -> Data? {
        let fields = [
            "pocket-ai-runtime-session-proof-v1",
            String(proof.protocolVersion.rawValue),
            proof.sessionId,
            proof.modelId,
            proof.modelFileSHA256.lowercased(),
            proof.runtimeBuildId,
            proof.expiresAt,
            String(proof.generationCounter),
            proof.keyId,
            proof.algorithm
        ]

        var output = Data()
        for field in fields {
            let bytes = Data(field.utf8)
            guard bytes.count <= Int(UInt32.max) else { return nil }
            var length = UInt32(bytes.count).bigEndian
            withUnsafeBytes(of: &length) { output.append(contentsOf: $0) }
            output.append(bytes)
        }
        return output
    }
}

/// Verifies runtime claims using only host-provisioned Ed25519 public keys.
/// The actor serializes verification and enforces strictly increasing generation
/// counters for each session during this verifier instance's lifetime.
public actor Ed25519RuntimeProofVerifier: RuntimeProofVerifier {
    private let trustedKeys: [String: RuntimeProofTrustedKey]
    private var acceptedSessions: [String: (keyId: String, generation: Int)] = [:]

    public init(trustedKeys: [RuntimeProofTrustedKey]) {
        let grouped = Dictionary(grouping: trustedKeys, by: \.keyId)
        self.trustedKeys = grouped.compactMapValues { entries in
            entries.count == 1 ? entries.first : nil
        }
    }

    public func verify(
        _ proof: RuntimeSessionProof,
        expectedModelId: String,
        expectedModelFileSHA256: String
    ) async -> Bool {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        let expiry = fractional.date(from: proof.expiresAt) ?? standard.date(from: proof.expiresAt)

        guard proof.protocolVersion == .v1,
              proof.algorithm == "Ed25519",
              proof.modelId == expectedModelId,
              proof.modelFileSHA256.range(of: "^[a-fA-F0-9]{64}$", options: .regularExpression) != nil,
              proof.modelFileSHA256.lowercased() == expectedModelFileSHA256.lowercased(),
              proof.generationCounter > 0,
              !proof.sessionId.isEmpty,
              let expiry, expiry > Date(),
              let trustedKey = trustedKeys[proof.keyId],
              trustedKey.keyId == proof.keyId,
              trustedKey.allowedRuntimeBuildIds.contains(proof.runtimeBuildId),
              let publicKey = try? Curve25519.Signing.PublicKey(rawRepresentation: trustedKey.rawPublicKey),
              let signature = Data(base64Encoded: proof.signature),
              signature.count == 64,
              signature.base64EncodedString() == proof.signature,
              let payload = RuntimeSessionProofCanonicalizer.canonicalPayload(proof),
              publicKey.isValidSignature(signature, for: payload) else {
            return false
        }

        if let previous = acceptedSessions[proof.sessionId] {
            guard previous.keyId == proof.keyId,
                  proof.generationCounter > previous.generation else {
                return false
            }
        }

        acceptedSessions[proof.sessionId] = (proof.keyId, proof.generationCounter)
        return true
    }
}

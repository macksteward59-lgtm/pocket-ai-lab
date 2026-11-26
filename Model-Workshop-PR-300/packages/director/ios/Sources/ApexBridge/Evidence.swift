import Foundation
#if canImport(CryptoKit)
import CryptoKit
#endif

public struct SignedRun: Sendable {
    public let text: String
    public let keyId: String
    public let conversationRequestId: String
    public let attemptId: String
    public let modelId: String
    public let modelFileHash: String
    public let runtimeSessionId: String
    public let runtimeVersion: String
    public let deviceId: String
    public let runtimeIdentity: String
    public let challengeNonce: String
    public let generationResultHash: String
    public let attestedAt: String
    public let healthCheckId: String
    public let signature: String

    public var canonical: String {
        [
            keyId,
            conversationRequestId,
            attemptId,
            modelId,
            modelFileHash,
            runtimeSessionId,
            runtimeVersion,
            deviceId,
            runtimeIdentity,
            challengeNonce,
            generationResultHash,
            attestedAt,
        ].joined(separator: "\n")
    }
}

public enum Evidence {
    public static func spkiPem(rawPublicKey: Data) -> String {
        let prefix = Data([0x30, 0x2A, 0x30, 0x05, 0x06, 0x03, 0x2B, 0x65, 0x70, 0x03, 0x21, 0x00])
        let body = (prefix + rawPublicKey).base64EncodedString()
        return "-----BEGIN PUBLIC KEY-----\n\(body)\n-----END PUBLIC KEY-----\n"
    }

    #if canImport(CryptoKit)
    public static func sign(payload: String, privateKey: Curve25519.Signing.PrivateKey) -> String {
        let signature = try? privateKey.signature(for: Data(payload.utf8))
        return signature?.base64EncodedString() ?? ""
    }
    #endif
}

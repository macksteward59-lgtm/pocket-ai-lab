import CryptoKit
import Foundation

enum ModelArtifactFingerprintError: Error, LocalizedError, Equatable {
    case sizeOverflow

    var errorDescription: String? {
        switch self {
        case .sizeOverflow:
            return "The model file is too large to fingerprint safely."
        }
    }
}

/// Streaming content identity. This is integrity metadata, not publisher
/// authenticity, provenance, device attestation, or action authorization.
struct ModelArtifactFingerprint: Equatable, Sendable {
    let sha256: String
    let byteCount: UInt64

    static func compute(at url: URL) throws -> ModelArtifactFingerprint {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        var hasher = SHA256()
        var byteCount: UInt64 = 0
        while true {
            guard let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty else {
                break
            }
            let (nextCount, overflow) = byteCount.addingReportingOverflow(UInt64(chunk.count))
            guard !overflow else { throw ModelArtifactFingerprintError.sizeOverflow }
            byteCount = nextCount
            hasher.update(data: chunk)
        }

        let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
        return ModelArtifactFingerprint(sha256: digest, byteCount: byteCount)
    }
}

struct ImportedModelArtifact: Sendable {
    let url: URL
    let fingerprint: ModelArtifactFingerprint
}

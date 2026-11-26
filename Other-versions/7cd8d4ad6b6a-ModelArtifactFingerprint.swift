import CryptoKit
import Foundation

enum ModelArtifactFingerprintError: LocalizedError {
    case sizeOverflow

    var errorDescription: String? {
        switch self {
        case .sizeOverflow:
            return "The model file is too large to fingerprint safely."
        }
    }
}

/// A content identity for one imported GGUF artifact. This is an integrity
/// fingerprint, not a publisher signature, provenance proof, or runtime attestation.
struct ModelArtifactFingerprint: Equatable, Sendable {
    let sha256: String
    let byteCount: UInt64

    static func compute(at url: URL) throws -> ModelArtifactFingerprint {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        var hasher = SHA256()
        var byteCount: UInt64 = 0
        let chunkSize = 1_048_576

        while true {
            guard let chunk = try handle.read(upToCount: chunkSize), !chunk.isEmpty else {
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

import Foundation
import CryptoKit

/// Test-only GCB1 construction. These scalar [-1, +1] centroids are synthetic
/// and untrained; they test transport plumbing, never representation quality.
/// Identity bytes are intentionally not normalized so rejection tests can
/// construct malformed artifacts with otherwise valid lengths and digests.
enum GIECodebookTestSupport {
    private enum FixtureError: Error { case invalidBounds }

    static func artifact(
        modelId: String,
        modelRevision: String,
        embeddingDimension: Int,
        maxTokensPerSegment: Int = 4
    ) throws -> Data {
        let modelBytes = Array(modelId.utf8)
        let revisionBytes = Array(modelRevision.utf8)
        guard (1...8_192).contains(embeddingDimension),
              (1...65_535).contains(maxTokensPerSegment),
              (1...1_024).contains(modelBytes.count),
              (1...1_024).contains(revisionBytes.count) else {
            throw FixtureError.invalidBounds
        }

        var data = Data([0x47, 0x43, 0x42, 0x31, 1, 0]) // GCB1, v1, flags
        appendUInt16(UInt16(embeddingDimension), to: &data)
        appendUInt16(UInt16(embeddingDimension), to: &data) // scalar subspaces
        appendUInt16(2, to: &data) // two centroids per subspace
        data.append(contentsOf: [1, 0]) // one residual stage, reserved
        appendUInt16(UInt16(maxTokensPerSegment), to: &data)
        appendUInt16(UInt16(modelBytes.count), to: &data)
        appendUInt16(UInt16(revisionBytes.count), to: &data)
        data.append(contentsOf: modelBytes)
        data.append(contentsOf: revisionBytes)
        for _ in 0..<embeddingDimension {
            appendUInt32(Float(-1).bitPattern, to: &data)
            appendUInt32(Float(1).bitPattern, to: &data)
        }
        return data
    }

    static func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private static func appendUInt16(_ value: UInt16, to data: inout Data) {
        data.append(UInt8(value & 0xff))
        data.append(UInt8((value >> 8) & 0xff))
    }

    private static func appendUInt32(_ value: UInt32, to data: inout Data) {
        for shift in stride(from: 0, to: 32, by: 8) {
            data.append(UInt8((value >> shift) & 0xff))
        }
    }
}

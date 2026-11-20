import Foundation
import XCTest
@testable import PocketLlamaEngine

/// Cross-runtime proof: the native encoder must use the exact GCB1 artifact
/// already validated by the TypeScript loader, not a hand-built codebook.
final class NativeGIEVerifiedArtifactRoundTripTests: XCTestCase {
    private struct ArtifactFixture: Decodable {
        let artifactHex: String
        let sha256: String
        let modelId: String
        let modelRevision: String
    }

    private struct SequenceFixture: Decodable {
        let sourceArtifact: String
        let codebookSha256: String
        let modelId: String
        let modelRevision: String
        let tokenCount: Int
        let embeddingDimension: Int
        let tokenEmbeddings: [Float]
        let payloadByteLength: Int
        let payloadHex: String
        let segmentTokenCounts: [Int]
        let decodedSegmentEmbeddings: [Float]
    }

    private enum FixtureError: Error {
        case invalidHex
    }

    private func load<T: Decodable>(_ resource: String, as type: T.Type) throws -> T {
        let url = try XCTUnwrap(Bundle.module.url(forResource: resource, withExtension: "json"))
        return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
    }

    private func data(hex: String) throws -> Data {
        guard hex.utf8.count.isMultiple(of: 2) else { throw FixtureError.invalidHex }
        var result = Data()
        result.reserveCapacity(hex.utf8.count / 2)
        var cursor = hex.startIndex
        while cursor < hex.endIndex {
            let next = hex.index(cursor, offsetBy: 2)
            guard let byte = UInt8(hex[cursor..<next], radix: 16) else {
                throw FixtureError.invalidHex
            }
            result.append(byte)
            cursor = next
        }
        return result
    }

    func testVerifiedGCB1ArtifactProducesExactSharedGIE1Bytes() throws {
        let artifact: ArtifactFixture = try load("gie-codebook-artifact-v1", as: ArtifactFixture.self)
        let fixture: SequenceFixture = try load("gie-verified-sequence-v1", as: SequenceFixture.self)
        XCTAssertEqual(fixture.sourceArtifact, "gie-codebook-artifact-v1.json")
        XCTAssertEqual(fixture.codebookSha256, artifact.sha256)
        XCTAssertEqual(fixture.modelId, artifact.modelId)
        XCTAssertEqual(fixture.modelRevision, artifact.modelRevision)

        let identity = NativeLatentModelIdentity(
            modelId: artifact.modelId, modelRevision: artifact.modelRevision
        )
        let codebook = try NativeGIECodebookArtifact.load(
            data(hex: artifact.artifactHex),
            expectedSHA256: artifact.sha256,
            expectedModelIdentity: identity
        )
        XCTAssertEqual(codebook.codebookId, fixture.codebookSha256)

        let encoder = try NativeGIESequenceEncoder(codebook: codebook)
        let payload = try encoder.encode(
            tokenEmbeddings: fixture.tokenEmbeddings,
            tokenCount: fixture.tokenCount,
            embeddingDimension: fixture.embeddingDimension,
            modelIdentity: identity
        )
        XCTAssertEqual(payload.count, fixture.payloadByteLength)
        XCTAssertEqual(payload, try data(hex: fixture.payloadHex))

        let decoded = try NativeGIESequenceCodec(codebook: codebook).decode(
            payload, modelIdentity: identity
        )
        XCTAssertEqual(decoded.tokenCount, fixture.tokenCount)
        XCTAssertEqual(decoded.embeddingDimension, fixture.embeddingDimension)
        XCTAssertEqual(decoded.segmentTokenCounts, fixture.segmentTokenCounts)
        XCTAssertEqual(decoded.segmentEmbeddings, fixture.decodedSegmentEmbeddings)

        // A verified codebook does not make a forged model identity or
        // a tampered GIE1 digest acceptable to the decoder.
        XCTAssertThrowsError(try encoder.encode(
            tokenEmbeddings: fixture.tokenEmbeddings,
            tokenCount: fixture.tokenCount,
            embeddingDimension: fixture.embeddingDimension,
            modelIdentity: NativeLatentModelIdentity(
                modelId: "another-model", modelRevision: identity.modelRevision
            )
        ))
        var modified = payload
        modified[18] ^= 1
        XCTAssertThrowsError(try NativeGIESequenceCodec(codebook: codebook).decode(
            modified, modelIdentity: identity
        )) { error in
            XCTAssertEqual(error as? NativeGIESequenceCodecError, .codebookMismatch)
        }
    }
}

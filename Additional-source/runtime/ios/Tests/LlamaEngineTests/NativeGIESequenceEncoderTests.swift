import XCTest
@testable import PocketLlamaEngine

final class NativeGIESequenceEncoderTests: XCTestCase {
    private let identity = NativeLatentModelIdentity(
        modelId: "shared-model",
        modelRevision: "sha256:model-rev-1"
    )

    private func codebook() -> NativeGIECodebook {
        NativeGIECodebook(
            codebookId: String(repeating: "a", count: 64),
            modelIdentity: identity,
            embeddingDimension: 4,
            subspaces: 2,
            codebookSize: 2,
            residualStages: 2,
            maxTokensPerSegment: 2,
            stages: [
                [[1, 2, 3, 4], [10, 20, 30, 40]],
                [[0.5, 0.25, -0.5, -0.25], [1, 2, -1, -2]]
            ]
        )
    }

    func testEncoderMatchesSharedTypeScriptGIE1WireFixtureByteForByte() throws {
        let codec = try NativeGIESequenceCodec(codebook: codebook())
        let encoder = try NativeGIESequenceEncoder(codebook: codebook())

        // Segment means are [10.5, 20.25, 2, 2] and
        // [0.5, 1.75, 31, 42], selecting the shared fixture's
        // exact stage/subspace index sequence. In particular, the
        // second segment selects residual-stage indices [1, 0],
        // not [0, 1], for the two subspaces.
        let input: [Float] = [
            10.5, 20.25, 2, 2,
            10.5, 20.25, 2, 2,
            0.5, 1.75, 31, 42
        ]
        let encoded = try encoder.encode(
            tokenEmbeddings: input,
            tokenCount: 3,
            embeddingDimension: 4,
            modelIdentity: identity
        )

        let fixtureHex =
            "474945310104000200020200030000000200" +
            String(repeating: "aa", count: 32) +
            "02000100" +
            "01000001" +
            "00010100"
        var fixture = Data()
        var cursor = fixtureHex.startIndex
        while cursor < fixtureHex.endIndex {
            let next = fixtureHex.index(cursor, offsetBy: 2)
            fixture.append(UInt8(fixtureHex[cursor..<next], radix: 16)!)
            cursor = next
        }
        XCTAssertEqual(encoded, fixture)

        let decoded = try codec.decode(encoded, modelIdentity: identity)
        XCTAssertEqual(decoded.tokenCount, 3)
        XCTAssertEqual(decoded.embeddingDimension, 4)
        XCTAssertEqual(decoded.segmentTokenCounts, [2, 1])
        XCTAssertEqual(decoded.segmentEmbeddings, [3.5, 4.25, 9, 18, 0.5, 1.75, 31, 42])
    }

    func testEncoderRejectsWrongIdentityShapeNonFiniteAndOversizedInput() throws {
        let encoder = try NativeGIESequenceEncoder(codebook: codebook())
        XCTAssertThrowsError(try encoder.encode(
            tokenEmbeddings: [1, 2, 3, 4],
            tokenCount: 1,
            embeddingDimension: 4,
            modelIdentity: NativeLatentModelIdentity(modelId: "other", modelRevision: identity.modelRevision)
        )) {
            XCTAssertEqual($0 as? NativeGIESequenceCodecError, .invalidModelIdentity)
        }
        XCTAssertThrowsError(try encoder.encode(
            tokenEmbeddings: [1, 2, 3],
            tokenCount: 1,
            embeddingDimension: 4,
            modelIdentity: identity
        ))
        XCTAssertThrowsError(try encoder.encode(
            tokenEmbeddings: [1, 2, .nan, 4],
            tokenCount: 1,
            embeddingDimension: 4,
            modelIdentity: identity
        ))
        XCTAssertThrowsError(try encoder.encode(
            tokenEmbeddings: [],
            tokenCount: 65_536,
            embeddingDimension: 4,
            modelIdentity: identity
        ))
        XCTAssertThrowsError(try encoder.encode(
            tokenEmbeddings: [1, 2, 3, 4],
            tokenCount: 1,
            embeddingDimension: 8,
            modelIdentity: identity
        ))
    }

    func testEncoderUsesFirstCodewordForExactDistanceTies() throws {
        let tied = NativeGIECodebook(
            codebookId: String(repeating: "b", count: 64),
            modelIdentity: identity,
            embeddingDimension: 2,
            subspaces: 1,
            codebookSize: 2,
            residualStages: 1,
            maxTokensPerSegment: 1,
            stages: [[[0, 0, 2, 0]]]
        )
        let encoder = try NativeGIESequenceEncoder(codebook: tied)
        let bytes = try encoder.encode(
            tokenEmbeddings: [1, 0],
            tokenCount: 1,
            embeddingDimension: 2,
            modelIdentity: identity
        )
        // 50-byte header + one 2-byte span + one index; equal distances
        // must select codeword zero, matching the TypeScript strict '<'.
        XCTAssertEqual(bytes.count, 53)
        XCTAssertEqual(bytes[52], 0)
    }
}

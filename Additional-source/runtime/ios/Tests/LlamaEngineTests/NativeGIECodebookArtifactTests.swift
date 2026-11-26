import XCTest
import CryptoKit
@testable import PocketLlamaEngine

final class NativeGIECodebookArtifactTests: XCTestCase {
    private struct Fixture: Decodable {
        let artifactLength: Int
        let artifactHex: String
        let sha256: String
        let modelId: String
        let modelRevision: String
    }

    private func fixture() throws -> (Fixture, Data) {
        let url = Bundle.module.url(forResource: "gie-codebook-artifact-v1", withExtension: "json")!
        let value = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        let bytes = stride(from: 0, to: value.artifactHex.count, by: 2).map { offset -> UInt8 in
            let start = value.artifactHex.index(value.artifactHex.startIndex, offsetBy: offset)
            let end = value.artifactHex.index(start, offsetBy: 2)
            return UInt8(value.artifactHex[start..<end], radix: 16)!
        }
        return (value, Data(bytes))
    }

    private func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    func testLoadsSharedCanonicalFixtureAndVerifiesDigestAndFloat32Values() throws {
        let (fixture, data) = try fixture()
        XCTAssertEqual(data.count, fixture.artifactLength)
        XCTAssertEqual(digest(data), fixture.sha256)

        let codebook = try NativeGIECodebookArtifact.load(
            data,
            expectedSHA256: fixture.sha256,
            expectedModelIdentity: NativeLatentModelIdentity(
                modelId: fixture.modelId,
                modelRevision: fixture.modelRevision
            )
        )
        XCTAssertEqual(codebook.codebookId, fixture.sha256)
        XCTAssertEqual(codebook.embeddingDimension, 2)
        XCTAssertEqual(codebook.subspaces, 1)
        XCTAssertEqual(codebook.codebookSize, 2)
        XCTAssertEqual(codebook.residualStages, 1)
        XCTAssertEqual(codebook.maxTokensPerSegment, 4)
        XCTAssertEqual(codebook.stages[0][0], [1.25, -2.5, 3.75, 4.5])
    }

    func testRejectsAlteredArtifactDigest() throws {
        let (fixture, data) = try fixture()
        var changed = data
        changed[changed.count - 1] ^= 0x01
        XCTAssertThrowsError(try NativeGIECodebookArtifact.load(
            changed,
            expectedSHA256: fixture.sha256,
            expectedModelIdentity: NativeLatentModelIdentity(
                modelId: fixture.modelId,
                modelRevision: fixture.modelRevision
            )
        ))
    }

    func testRejectsWrongModelIdentity() throws {
        let (fixture, data) = try fixture()
        XCTAssertThrowsError(try NativeGIECodebookArtifact.load(
            data,
            expectedSHA256: fixture.sha256,
            expectedModelIdentity: NativeLatentModelIdentity(
                modelId: "different-model",
                modelRevision: fixture.modelRevision
            )
        ))
    }

    func testRejectsNonCanonicalUnicodeBytesEvenWithMatchingDigestAndIdentity() throws {
        let canonical = NativeLatentModelIdentity(modelId: "model-caf\u{e9}", modelRevision: "r\u{e9}vision")
        let canonicalBytes = try GIECodebookTestSupport.artifact(
            modelId: canonical.modelId, modelRevision: canonical.modelRevision,
            embeddingDimension: 2
        )
        XCTAssertNoThrow(try NativeGIECodebookArtifact.load(
            canonicalBytes, expectedSHA256: digest(canonicalBytes), expectedModelIdentity: canonical
        ))

        let decomposedIdentities = [
            NativeLatentModelIdentity(modelId: "model-cafe\u{301}", modelRevision: canonical.modelRevision),
            NativeLatentModelIdentity(modelId: canonical.modelId, modelRevision: "re\u{301}vision")
        ]
        for identity in decomposedIdentities {
            let bytes = try GIECodebookTestSupport.artifact(
                modelId: identity.modelId, modelRevision: identity.modelRevision,
                embeddingDimension: 2
            )
            // Expected identity uses the same malformed bytes. Digest and
            // identity matching cannot substitute for NFC byte validation.
            XCTAssertThrowsError(try NativeGIECodebookArtifact.load(
                bytes, expectedSHA256: digest(bytes), expectedModelIdentity: identity
            )) { XCTAssertEqual($0 as? NativeGIESequenceCodecError, .invalidModelIdentity) }
        }
    }

    func testCanonicalArtifactRequiresByteExactExpectedUnicodeIdentity() throws {
        let canonical = NativeLatentModelIdentity(modelId: "model-caf\u{e9}", modelRevision: "r\u{e9}vision")
        let bytes = try GIECodebookTestSupport.artifact(
            modelId: canonical.modelId, modelRevision: canonical.modelRevision,
            embeddingDimension: 2
        )
        for expected in [
            NativeLatentModelIdentity(modelId: "model-cafe\u{301}", modelRevision: canonical.modelRevision),
            NativeLatentModelIdentity(modelId: canonical.modelId, modelRevision: "re\u{301}vision")
        ] {
            XCTAssertThrowsError(try NativeGIECodebookArtifact.load(
                bytes, expectedSHA256: digest(bytes), expectedModelIdentity: expected
            )) { XCTAssertEqual($0 as? NativeGIESequenceCodecError, .invalidModelIdentity) }
        }
    }

    func testRejectsTrailingBytesEvenWhenDigestMatchesBytes() throws {
        let (fixture, data) = try fixture()
        var changed = data
        changed.append(0)
        XCTAssertThrowsError(try NativeGIECodebookArtifact.load(
            changed,
            expectedSHA256: digest(changed),
            expectedModelIdentity: NativeLatentModelIdentity(
                modelId: fixture.modelId,
                modelRevision: fixture.modelRevision
            )
        ))
    }

    func testRejectsUnsupportedVersionAndReservedFlags() throws {
        let (fixture, data) = try fixture()
        for (offset, value) in [(4, UInt8(2)), (5, UInt8(1)), (13, UInt8(1))] {
            var changed = data
            changed[offset] = value
            XCTAssertThrowsError(try NativeGIECodebookArtifact.load(
                changed, expectedSHA256: digest(changed),
                expectedModelIdentity: NativeLatentModelIdentity(modelId: fixture.modelId, modelRevision: fixture.modelRevision)
            ))
        }
    }

    func testRejectsMalformedUTF8Identity() throws {
        let (fixture, data) = try fixture()
        var changed = data
        changed[20] = 0xff
        XCTAssertThrowsError(try NativeGIECodebookArtifact.load(
            changed, expectedSHA256: digest(changed),
            expectedModelIdentity: NativeLatentModelIdentity(modelId: fixture.modelId, modelRevision: fixture.modelRevision)
        ))
    }

    func testRejectsNegativeZeroAndNonFiniteFloat32() throws {
        let (fixture, data) = try fixture()
        let valueOffset = 20 + fixture.modelId.utf8.count + fixture.modelRevision.utf8.count
        for pattern: [UInt8] in [[0x00, 0x00, 0x00, 0x80], [0x00, 0x00, 0xc0, 0x7f]] {
            var changed = data
            changed.replaceSubrange(valueOffset..<(valueOffset + 4), with: pattern)
            XCTAssertThrowsError(try NativeGIECodebookArtifact.load(
                changed, expectedSHA256: digest(changed),
                expectedModelIdentity: NativeLatentModelIdentity(modelId: fixture.modelId, modelRevision: fixture.modelRevision)
            ))
        }
    }
}

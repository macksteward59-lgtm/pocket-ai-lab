import Foundation
import CryptoKit

/// Loads a canonical GCB1 artifact and verifies its exact bytes before exposing
/// Float32 codebook tables to the GIE decoder.
public enum NativeGIECodebookArtifact {
    public static let maximumArtifactBytes = 25 * 1024 * 1024

    public static func load(
        _ data: Data,
        expectedSHA256: String,
        expectedModelIdentity: NativeLatentModelIdentity
    ) throws -> NativeGIECodebook {
        guard data.count >= 20, data.count <= maximumArtifactBytes,
              expectedSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            throw NativeGIESequenceCodecError.invalidCodebook
        }

        let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
        guard digest == expectedSHA256 else {
            throw NativeGIESequenceCodecError.codebookMismatch
        }

        let bytes = [UInt8](data)
        guard Array(bytes[0..<4]) == [0x47, 0x43, 0x42, 0x31],
              bytes[4] == 1, bytes[5] == 0, bytes[13] == 0 else {
            throw NativeGIESequenceCodecError.invalidCodebook
        }

        let dimension = Int(readUInt16(bytes, 6))
        let subspaces = Int(readUInt16(bytes, 8))
        let codebookSize = Int(readUInt16(bytes, 10))
        let residualStages = Int(bytes[12])
        let maxTokensPerSegment = Int(readUInt16(bytes, 14))
        let modelIdLength = Int(readUInt16(bytes, 16))
        let revisionLength = Int(readUInt16(bytes, 18))

        guard (1...8192).contains(dimension),
              subspaces > 0, dimension.isMultiple(of: subspaces),
              (2...256).contains(codebookSize),
              (1...3).contains(residualStages),
              (1...65535).contains(maxTokensPerSegment),
              (1...1024).contains(modelIdLength),
              (1...1024).contains(revisionLength) else {
            throw NativeGIESequenceCodecError.invalidCodebook
        }

        let stringsEnd = 20 + modelIdLength + revisionLength
        let valuesPerStage = subspaces * codebookSize * (dimension / subspaces)
        let valueCount = residualStages * valuesPerStage
        let expectedLength = stringsEnd + valueCount * 4
        guard expectedLength == bytes.count else {
            throw NativeGIESequenceCodecError.invalidPayloadLength
        }

        let modelIdData = Data(bytes[20..<(20 + modelIdLength)])
        let revisionData = Data(bytes[(20 + modelIdLength)..<stringsEnd])
        guard let modelId = String(data: modelIdData, encoding: .utf8),
              let revision = String(data: revisionData, encoding: .utf8),
              modelIdData == Data(modelId.precomposedStringWithCanonicalMapping.utf8),
              revisionData == Data(revision.precomposedStringWithCanonicalMapping.utf8),
              !modelId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !revision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw NativeGIESequenceCodecError.invalidModelIdentity
        }
        let identity = NativeLatentModelIdentity(modelId: modelId, modelRevision: revision)
        // Swift String equality accepts canonically equivalent spellings. GCB1
        // requires already-NFC bytes and the same exact identity as TypeScript.
        guard modelIdData == Data(expectedModelIdentity.modelId.utf8),
              revisionData == Data(expectedModelIdentity.modelRevision.utf8) else {
            throw NativeGIESequenceCodecError.invalidModelIdentity
        }

        var cursor = stringsEnd
        var stages: [[[Float]]] = []
        stages.reserveCapacity(residualStages)
        for _ in 0..<residualStages {
            var stage: [[Float]] = []
            stage.reserveCapacity(subspaces)
            for _ in 0..<subspaces {
                var table: [Float] = []
                table.reserveCapacity(codebookSize * (dimension / subspaces))
                for _ in 0..<(codebookSize * (dimension / subspaces)) {
                    let bits = readUInt32(bytes, cursor)
                    cursor += 4
                    guard bits != 0x80000000 else {
                        throw NativeGIESequenceCodecError.invalidCodebook
                    }
                    let value = Float(bitPattern: bits)
                    guard value.isFinite else {
                        throw NativeGIESequenceCodecError.invalidCodebook
                    }
                    table.append(value)
                }
                stage.append(table)
            }
            stages.append(stage)
        }

        return try NativeGIECodebook(
            codebookId: digest,
            modelIdentity: identity,
            embeddingDimension: dimension,
            subspaces: subspaces,
            codebookSize: codebookSize,
            residualStages: residualStages,
            maxTokensPerSegment: maxTokensPerSegment,
            stages: stages
        ).validatedForArtifact()
    }

    private static func readUInt16(_ bytes: [UInt8], _ offset: Int) -> UInt16 {
        UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
    }

    private static func readUInt32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
        UInt32(bytes[offset])
            | (UInt32(bytes[offset + 1]) << 8)
            | (UInt32(bytes[offset + 2]) << 16)
            | (UInt32(bytes[offset + 3]) << 24)
    }
}

private extension NativeGIECodebook {
    func validatedForArtifact() throws -> NativeGIECodebook {
        try NativeGIESequenceCodec(codebook: self)
        return self
    }
}

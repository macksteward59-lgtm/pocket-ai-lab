import Foundation
import CryptoKit

/// Immutable same-model GIE codebook material. Tables are flattened as
/// [codeword][dimensionWithinSubspace], matching the TypeScript codec.
public struct NativeGIECodebook: Sendable {
    public let codebookId: String
    public let modelIdentity: NativeLatentModelIdentity
    public let embeddingDimension: Int
    public let subspaces: Int
    public let codebookSize: Int
    public let residualStages: Int
    public let maxTokensPerSegment: Int
    public let stages: [[[Float]]]

    public init(
        codebookId: String,
        modelIdentity: NativeLatentModelIdentity,
        embeddingDimension: Int,
        subspaces: Int,
        codebookSize: Int,
        residualStages: Int,
        maxTokensPerSegment: Int,
        stages: [[[Float]]]
    ) {
        self.codebookId = codebookId
        self.modelIdentity = modelIdentity
        self.embeddingDimension = embeddingDimension
        self.subspaces = subspaces
        self.codebookSize = codebookSize
        self.residualStages = residualStages
        self.maxTokensPerSegment = maxTokensPerSegment
        self.stages = stages
    }
}

public struct NativeGIEDecodedSequence: Sendable, Equatable {
    public let tokenCount: Int
    public let embeddingDimension: Int
    public let segmentTokenCounts: [Int]
    /// One reconstructed pooled vector per ordered temporal segment.
    /// This is intentionally not a token-by-token reconstruction.
    public let segmentEmbeddings: [Float]
}

public enum NativeGIESequenceCodecError: Error, Equatable, Sendable {
    case invalidCodebook
    case invalidModelIdentity
    case truncatedPayload
    case invalidMagic
    case codebookMismatch
    case invalidBounds
    case invalidPayloadLength
    case invalidSegmentSpans
    case invalidCodewordIndex
    case nonFiniteReconstruction
}

/// Decoder for the TypeScript PooledProductQuantizer GIE1 wire format.
/// Codebook artifact loading is deliberately external: the host must verify
/// the canonical artifact bytes against codebookId before constructing this
/// value. This type validates the digest syntax and binds payloads to it; it
/// does not claim that a caller-supplied digest proves artifact authenticity.
public struct NativeGIESequenceCodec: Sendable {
    public static let codecId = "pocket-gie-product-quantizer"
    public static let codecVersion = "1"
    private static let headerBytes = 50
    private static let maximumTokens = 65_535
    private static let maximumDimension = 8_192
    private static let maximumSegments = 4_096
    private static let maximumElements = 16 * 1024 * 1024

    public let codebook: NativeGIECodebook

    public init(codebook: NativeGIECodebook) throws {
        guard codebook.codebookId.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              !codebook.modelIdentity.modelId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !codebook.modelIdentity.modelRevision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              codebook.embeddingDimension > 0,
              codebook.embeddingDimension <= Self.maximumDimension,
              codebook.subspaces > 0,
              codebook.embeddingDimension.isMultiple(of: codebook.subspaces),
              (2...256).contains(codebook.codebookSize),
              (1...3).contains(codebook.residualStages),
              (1...65_535).contains(codebook.maxTokensPerSegment),
              codebook.stages.count == codebook.residualStages else {
            throw NativeGIESequenceCodecError.invalidCodebook
        }
        let subspaceDimension = codebook.embeddingDimension / codebook.subspaces
        for stage in codebook.stages {
            guard stage.count == codebook.subspaces else {
                throw NativeGIESequenceCodecError.invalidCodebook
            }
            for table in stage {
                guard table.count == codebook.codebookSize * subspaceDimension,
                      table.allSatisfy(\.isFinite) else {
                    throw NativeGIESequenceCodecError.invalidCodebook
                }
            }
        }
        self.codebook = codebook
    }

    public func decode(
        _ data: Data,
        modelIdentity: NativeLatentModelIdentity
    ) throws -> NativeGIEDecodedSequence {
        guard modelIdentity == codebook.modelIdentity else {
            throw NativeGIESequenceCodecError.invalidModelIdentity
        }
        guard data.count >= Self.headerBytes else {
            throw NativeGIESequenceCodecError.truncatedPayload
        }
        let bytes = [UInt8](data)
        guard Array(bytes[0..<4]) == [0x47, 0x49, 0x45, 0x31] else {
            throw NativeGIESequenceCodecError.invalidMagic
        }

        let version = bytes[4]
        let dimension = Int(readUInt16(bytes, at: 5))
        let subspaces = Int(readUInt16(bytes, at: 7))
        let stages = Int(bytes[9])
        let codebookSize = Int(readUInt16(bytes, at: 10))
        let tokenCount = Int(readUInt32(bytes, at: 12))
        let segmentCount = Int(readUInt16(bytes, at: 16))
        let digest = bytes[18..<50].map { String(format: "%02x", $0) }.joined()

        guard version == 1,
              digest == codebook.codebookId,
              dimension == codebook.embeddingDimension,
              subspaces == codebook.subspaces,
              stages == codebook.residualStages,
              codebookSize == codebook.codebookSize,
              (1...Self.maximumTokens).contains(tokenCount),
              (1...Self.maximumSegments).contains(segmentCount) else {
            throw NativeGIESequenceCodecError.codebookMismatch
        }

        let (elementCount, elementOverflow) = segmentCount.multipliedReportingOverflow(by: dimension)
        guard !elementOverflow, elementCount <= Self.maximumElements else {
            throw NativeGIESequenceCodecError.invalidBounds
        }
        let (spanBytes, spanOverflow) = segmentCount.multipliedReportingOverflow(by: 2)
        let (indexCount, indexOverflowA) = segmentCount.multipliedReportingOverflow(by: stages)
        let (indexCount2, indexOverflowB) = indexCount.multipliedReportingOverflow(by: subspaces)
        let (lengthA, lengthOverflowA) = Self.headerBytes.addingReportingOverflow(spanBytes)
        let (expectedLength, lengthOverflowB) = lengthA.addingReportingOverflow(indexCount2)
        guard !spanOverflow, !indexOverflowA, !indexOverflowB,
              !lengthOverflowA, !lengthOverflowB,
              expectedLength == bytes.count else {
            throw NativeGIESequenceCodecError.invalidPayloadLength
        }

        var spans: [Int] = []
        spans.reserveCapacity(segmentCount)
        var totalTokens = 0
        var cursor = Self.headerBytes
        for _ in 0..<segmentCount {
            let span = Int(readUInt16(bytes, at: cursor))
            cursor += 2
            guard span > 0, span <= codebook.maxTokensPerSegment else {
                throw NativeGIESequenceCodecError.invalidSegmentSpans
            }
            let (nextTotal, overflow) = totalTokens.addingReportingOverflow(span)
            guard !overflow else { throw NativeGIESequenceCodecError.invalidSegmentSpans }
            totalTokens = nextTotal
            spans.append(span)
        }
        guard totalTokens == tokenCount else {
            throw NativeGIESequenceCodecError.invalidSegmentSpans
        }

        let subspaceDimension = dimension / subspaces
        var reconstructed = [Float](repeating: 0, count: elementCount)
        for segment in 0..<segmentCount {
            let outputOffset = segment * dimension
            for stage in 0..<stages {
                for subspace in 0..<subspaces {
                    let index = Int(bytes[cursor])
                    cursor += 1
                    guard index < codebookSize else {
                        throw NativeGIESequenceCodecError.invalidCodewordIndex
                    }
                    let table = codebook.stages[stage][subspace]
                    let centroidOffset = index * subspaceDimension
                    let targetOffset = outputOffset + subspace * subspaceDimension
                    for component in 0..<subspaceDimension {
                        reconstructed[targetOffset + component] += table[centroidOffset + component]
                    }
                }
            }
        }
        guard reconstructed.allSatisfy(\.isFinite) else {
            throw NativeGIESequenceCodecError.nonFiniteReconstruction
        }
        return NativeGIEDecodedSequence(
            tokenCount: tokenCount,
            embeddingDimension: dimension,
            segmentTokenCounts: spans,
            segmentEmbeddings: reconstructed
        )
    }

    private func readUInt16(_ bytes: [UInt8], at offset: Int) -> UInt16 {
        UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
    }

    private func readUInt32(_ bytes: [UInt8], at offset: Int) -> UInt32 {
        UInt32(bytes[offset])
            | (UInt32(bytes[offset + 1]) << 8)
            | (UInt32(bytes[offset + 2]) << 16)
            | (UInt32(bytes[offset + 3]) << 24)
    }
}

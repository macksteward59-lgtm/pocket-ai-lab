import Foundation

/// Native encoder for the TypeScript GIE1 pooled product-quantizer wire format.
/// Arithmetic used for pooling and nearest-centroid selection is Float64/Double,
/// matching JavaScript Number semantics over the Float32 source activations and
/// canonical Float32 codebook values.
public struct NativeGIESequenceEncoder: Sendable {
    private static let headerBytes = 50
    private static let maximumTokens = 65_535
    private static let maximumDimension = 8_192
    private static let maximumSegments = 4_096
    private static let maximumElements = 16 * 1024 * 1024

    public let codebook: NativeGIECodebook

    public init(codebook: NativeGIECodebook) throws {
        // Reuse the decoder's complete codebook structural validation.
        _ = try NativeGIESequenceCodec(codebook: codebook)
        self.codebook = codebook
    }

    /// Encodes row-major generated-token embeddings into a GIE1 payload.
    /// The returned representation contains one pooled vector's indices per
    /// ordered temporal segment; it does not preserve token-level vectors.
    public func encode(
        tokenEmbeddings: [Float],
        tokenCount: Int,
        embeddingDimension: Int,
        modelIdentity: NativeLatentModelIdentity
    ) throws -> Data {
        guard modelIdentity == codebook.modelIdentity else {
            throw NativeGIESequenceCodecError.invalidModelIdentity
        }
        guard embeddingDimension == codebook.embeddingDimension,
              (1...Self.maximumTokens).contains(tokenCount),
              (1...Self.maximumDimension).contains(embeddingDimension) else {
            throw NativeGIESequenceCodecError.invalidBounds
        }
        let (expectedInputCount, inputOverflow) = tokenCount.multipliedReportingOverflow(by: embeddingDimension)
        guard !inputOverflow,
              expectedInputCount <= Self.maximumElements,
              tokenEmbeddings.count == expectedInputCount,
              tokenEmbeddings.allSatisfy(\.isFinite) else {
            throw NativeGIESequenceCodecError.invalidBounds
        }

        let segmentWidth = codebook.maxTokensPerSegment
        let segmentCount = (tokenCount + segmentWidth - 1) / segmentWidth
        guard (1...Self.maximumSegments).contains(segmentCount) else {
            throw NativeGIESequenceCodecError.invalidBounds
        }
        let (decodedElementCount, decodedOverflow) = segmentCount.multipliedReportingOverflow(by: embeddingDimension)
        let (indexCountA, indexOverflowA) = segmentCount.multipliedReportingOverflow(by: codebook.residualStages)
        let (indexCount, indexOverflowB) = indexCountA.multipliedReportingOverflow(by: codebook.subspaces)
        let (spanBytes, spanOverflow) = segmentCount.multipliedReportingOverflow(by: 2)
        let (headerAndSpans, lengthOverflowA) = Self.headerBytes.addingReportingOverflow(spanBytes)
        let (payloadLength, lengthOverflowB) = headerAndSpans.addingReportingOverflow(indexCount)
        guard !decodedOverflow, decodedElementCount <= Self.maximumElements,
              !indexOverflowA, !indexOverflowB, !spanOverflow,
              !lengthOverflowA, !lengthOverflowB else {
            throw NativeGIESequenceCodecError.invalidBounds
        }

        let dimension = embeddingDimension
        let subspaces = codebook.subspaces
        let subspaceDimension = dimension / subspaces
        var spans: [Int] = []
        spans.reserveCapacity(segmentCount)
        var indices = Data()
        indices.reserveCapacity(indexCount)

        for segment in 0..<segmentCount {
            let startToken = segment * segmentWidth
            let span = min(segmentWidth, tokenCount - startToken)
            guard (1...65_535).contains(span) else {
                throw NativeGIESequenceCodecError.invalidSegmentSpans
            }
            spans.append(span)

            // The TS implementation accumulates Float32 source values in
            // Float64 means, then performs residual quantization in Float64.
            var residual = [Double](repeating: 0, count: dimension)
            for tokenOffset in 0..<span {
                let base = (startToken + tokenOffset) * dimension
                for component in 0..<dimension {
                    residual[component] += Double(tokenEmbeddings[base + component])
                }
            }
            for component in 0..<dimension {
                residual[component] /= Double(span)
            }

            for stage in 0..<codebook.residualStages {
                for subspace in 0..<subspaces {
                    let componentOffset = subspace * subspaceDimension
                    let table = codebook.stages[stage][subspace]
                    var bestIndex = 0
                    var bestDistance = Double.infinity
                    for candidate in 0..<codebook.codebookSize {
                        let centroidOffset = candidate * subspaceDimension
                        var distance = 0.0
                        for component in 0..<subspaceDimension {
                            let delta = residual[componentOffset + component]
                                - Double(table[centroidOffset + component])
                            distance += delta * delta
                        }
                        // Strict comparison preserves the first-index tie break
                        // used by TypeScript's nearestCodeword implementation.
                        if distance < bestDistance {
                            bestDistance = distance
                            bestIndex = candidate
                        }
                    }
                    guard bestIndex >= 0, bestIndex < codebook.codebookSize,
                          bestIndex <= 255 else {
                        throw NativeGIESequenceCodecError.invalidCodewordIndex
                    }
                    indices.append(UInt8(bestIndex))
                    let centroidOffset = bestIndex * subspaceDimension
                    for component in 0..<subspaceDimension {
                        residual[componentOffset + component] -=
                            Double(table[centroidOffset + component])
                    }
                }
            }
        }

        var payload = Data()
        payload.reserveCapacity(payloadLength)
        payload.append(contentsOf: [0x47, 0x49, 0x45, 0x31]) // GIE1
        payload.append(1)
        Self.appendUInt16(UInt16(dimension), to: &payload)
        Self.appendUInt16(UInt16(subspaces), to: &payload)
        payload.append(UInt8(codebook.residualStages))
        Self.appendUInt16(UInt16(codebook.codebookSize), to: &payload)
        Self.appendUInt32(UInt32(tokenCount), to: &payload)
        Self.appendUInt16(UInt16(segmentCount), to: &payload)

        let digest = codebook.codebookId
        guard digest.count == 64 else {
            throw NativeGIESequenceCodecError.invalidCodebook
        }
        var digestIndex = digest.startIndex
        for _ in 0..<32 {
            let next = digest.index(digestIndex, offsetBy: 2)
            guard let byte = UInt8(digest[digestIndex..<next], radix: 16) else {
                throw NativeGIESequenceCodecError.invalidCodebook
            }
            payload.append(byte)
            digestIndex = next
        }

        for span in spans {
            Self.appendUInt16(UInt16(span), to: &payload)
        }
        payload.append(indices)
        guard payload.count == payloadLength else {
            throw NativeGIESequenceCodecError.invalidPayloadLength
        }
        return payload
    }

    private static func appendUInt16(_ value: UInt16, to data: inout Data) {
        data.append(UInt8(value & 0xff))
        data.append(UInt8((value >> 8) & 0xff))
    }

    private static func appendUInt32(_ value: UInt32, to data: inout Data) {
        data.append(UInt8(value & 0xff))
        data.append(UInt8((value >> 8) & 0xff))
        data.append(UInt8((value >> 16) & 0xff))
        data.append(UInt8((value >> 24) & 0xff))
    }
}

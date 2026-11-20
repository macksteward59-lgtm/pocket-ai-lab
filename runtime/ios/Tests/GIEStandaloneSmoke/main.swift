import Foundation

// Build-only boundary for this isolated codec executable. The full iOS app
// supplies the real NativeLatentModelIdentity type. No separate runtime or
// second codec is implemented here.
public struct NativeLatentModelIdentity: Equatable, Sendable {
    public let modelId: String
    public let modelRevision: String

    public init(modelId: String, modelRevision: String) {
        self.modelId = modelId
        self.modelRevision = modelRevision
    }
}

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

private enum SmokeFailure: Error, CustomStringConvertible {
    case invalidInput(String)
    case mismatch(String)
    var description: String {
        switch self {
        case .invalidInput(let message): return "invalid input: \(message)"
        case .mismatch(let message): return "invariant mismatch: \(message)"
        }
    }
}

private func loadFixture<T: Decodable>(_ path: String, as type: T.Type) throws -> T {
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    return try JSONDecoder().decode(T.self, from: data)
}

private func bytes(hex: String) throws -> Data {
    guard hex.utf8.count.isMultiple(of: 2) else {
        throw SmokeFailure.invalidInput("odd-length hex fixture")
    }
    var value = Data()
    value.reserveCapacity(hex.utf8.count / 2)
    var cursor = hex.startIndex
    while cursor < hex.endIndex {
        let next = hex.index(cursor, offsetBy: 2)
        guard let byte = UInt8(hex[cursor..<next], radix: 16) else {
            throw SmokeFailure.invalidInput("invalid hex byte")
        }
        value.append(byte)
        cursor = next
    }
    return value
}

private func require(_ condition: @autoclosure () -> Bool, _ label: String) throws {
    if !condition() { throw SmokeFailure.mismatch(label) }
}

private func requireError(
    _ expected: NativeGIESequenceCodecError,
    label: String,
    operation: () throws -> Void
) throws {
    do {
        try operation()
    } catch let error as NativeGIESequenceCodecError {
        try require(error == expected, "\(label): unexpected error \(error)")
        return
    }
    throw SmokeFailure.mismatch("\(label): failed to reject invalid input")
}

private func run() throws {
    guard CommandLine.arguments.count == 3 else {
        throw SmokeFailure.invalidInput("usage: gie-smoke <gcb1.json> <gie1.json>")
    }
    let artifact: ArtifactFixture = try loadFixture(CommandLine.arguments[1], as: ArtifactFixture.self)
    let sequence: SequenceFixture = try loadFixture(CommandLine.arguments[2], as: SequenceFixture.self)
    try require(sequence.sourceArtifact == "gie-codebook-artifact-v1.json", "unexpected source fixture")
    try require(sequence.codebookSha256 == artifact.sha256, "canonical digest mismatch")
    try require(sequence.modelId == artifact.modelId, "model identity mismatch")
    try require(sequence.modelRevision == artifact.modelRevision, "model revision mismatch")

    let identity = NativeLatentModelIdentity(
        modelId: artifact.modelId,
        modelRevision: artifact.modelRevision
    )
    let artifactBytes = try bytes(hex: artifact.artifactHex)
    let codebook = try NativeGIECodebookArtifact.load(
        artifactBytes,
        expectedSHA256: artifact.sha256,
        expectedModelIdentity: identity
    )
    try require(codebook.codebookId == artifact.sha256, "loaded codebook hash")
    let encoder = try NativeGIESequenceEncoder(codebook: codebook)
    let codec = try NativeGIESequenceCodec(codebook: codebook)
    let encoded = try encoder.encode(
        tokenEmbeddings: sequence.tokenEmbeddings,
        tokenCount: sequence.tokenCount,
        embeddingDimension: sequence.embeddingDimension,
        modelIdentity: identity
    )
    try require(encoded.count == sequence.payloadByteLength, "GIE1 byte count")
    try require(encoded == (try bytes(hex: sequence.payloadHex)), "exact shared TypeScript GIE1 wire bytes")

    let decoded = try codec.decode(encoded, modelIdentity: identity)
    try require(decoded.tokenCount == sequence.tokenCount, "token count")
    try require(decoded.embeddingDimension == sequence.embeddingDimension, "embedding dimension")
    try require(decoded.segmentTokenCounts == sequence.segmentTokenCounts, "ordered segment spans")
    try require(decoded.segmentEmbeddings == sequence.decodedSegmentEmbeddings, "pooled segment vectors")

    // Verify that neither a modified GIE1 digest nor an altered artifact is
    // silently accepted. These are integrity checks, NOT publisher signatures.
    var changedPayload = encoded
    changedPayload[18] ^= 0x01
    try requireError(.codebookMismatch, label: "GIE1 tampered digest") {
        _ = try codec.decode(changedPayload, modelIdentity: identity)
    }

    var changedArtifact = artifactBytes
    changedArtifact[changedArtifact.count - 1] ^= 0x01
    try requireError(.codebookMismatch, label: "GCB1 tampered bytes") {
        _ = try NativeGIECodebookArtifact.load(
            changedArtifact,
            expectedSHA256: artifact.sha256,
            expectedModelIdentity: identity
        )
    }

    let wrongIdentity = NativeLatentModelIdentity(
        modelId: "different-model",
        modelRevision: identity.modelRevision
    )
    try requireError(.invalidModelIdentity, label: "foreign model encoder") {
        _ = try encoder.encode(
            tokenEmbeddings: sequence.tokenEmbeddings,
            tokenCount: sequence.tokenCount,
            embeddingDimension: sequence.embeddingDimension,
            modelIdentity: wrongIdentity
        )
    }

    print("POCKET_GIE_STANDALONE_OK artifactSHA256=\(artifact.sha256) GIE1Bytes=\(encoded.count) segments=\(decoded.segmentTokenCounts.count)")
}

do {
    try run()
} catch {
    fputs("POCKET_GIE_STANDALONE_FAILED: \(error)\n", stderr)
    exit(EXIT_FAILURE)
}

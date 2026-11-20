import Foundation

/// Encoding-only bridge from an actual bounded native token sequence to the
/// versioned same-model GIE1 wire format. This never routes to another agent,
/// invokes a tool, authorizes a transfer, or proves receiving-model ingestion.
public struct NativeGIEEncodedGeneration: Sendable {
    public let modelIdentity: NativeLatentModelIdentity
    public let providerKind: NativeInferenceProviderKind
    public let text: String
    public let tokenCount: Int
    public let embeddingDimension: Int
    public let codebookSHA256: String
    public let payload: Data

    public var payloadByteLength: Int { payload.count }
}

public enum NativeGIECaptureError: Error, Equatable, Sendable {
    case modelIdentityMismatch
    case invalidCaptureBounds
    case payloadTooLarge
}

/// Host-owned composition adapter: exact native lease, real sequence-capable
/// engine, previously selected immutable model revision, canonical GCB1 bytes.
/// The revision/digest inputs MUST be authenticated by the host. A valid digest
/// alone is neither publisher authentication nor a signed generation receipt.
public enum NativeGIECaptureEncoder {
    public static let maximumLatentTokens = 256
    public static let maximumLatentBytes = 16 * 1024 * 1024
    public static let maximumPayloadBytes = 16 * 1024 * 1024

    /// Verify the codebook and route identity BEFORE starting native inference.
    /// The native runtime itself owns the lease, scheduler, cancellation/drain,
    /// model-output checks and resource-use pins.
    public static func generate(
        runtime: NativeInferenceRuntime,
        lease: ModelPoolLease,
        request: GenerationRequest,
        expectedModelIdentity: NativeLatentModelIdentity,
        codebookArtifact: Data,
        expectedCodebookSHA256: String,
        maxLatentTokens: Int = maximumLatentTokens,
        maxLatentBytes: Int = maximumLatentBytes,
        maxPayloadBytes: Int = maximumPayloadBytes
    ) async throws -> NativeGIEEncodedGeneration {
        guard expectedModelIdentity.modelId.utf8.elementsEqual(lease.model.id.utf8),
              expectedModelIdentity.modelId.utf8.elementsEqual(lease.session.modelId.utf8),
              !expectedModelIdentity.modelRevision.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw NativeGIECaptureError.modelIdentityMismatch
        }
        guard maxLatentTokens > 0, maxLatentTokens <= maximumLatentTokens,
              maxLatentBytes > 0, maxLatentBytes <= maximumLatentBytes,
              maxPayloadBytes > 0, maxPayloadBytes <= maximumPayloadBytes,
              request.maxTokens > 0, request.maxTokens <= maxLatentTokens else {
            throw NativeGIECaptureError.invalidCaptureBounds
        }

        let codebook = try NativeGIECodebookArtifact.load(
            codebookArtifact,
            expectedSHA256: expectedCodebookSHA256,
            expectedModelIdentity: expectedModelIdentity
        )
        let encoder = try NativeGIESequenceEncoder(codebook: codebook)
        guard maxPayloadBytes >= encoder.minimumPayloadByteLength else {
            throw NativeGIECaptureError.payloadTooLarge
        }
        try Task.checkCancellation()

        let captured = try await runtime.generateWithLatentSequence(
            lease: lease,
            request: request,
            maxLatentTokens: maxLatentTokens,
            maxLatentBytes: maxLatentBytes
        )
        try Task.checkCancellation()
        return try encodeValidated(
            captured,
            expectedModelIdentity: expectedModelIdentity,
            encoder: encoder,
            providerKind: runtime.providerKind,
            maxLatentTokens: maxLatentTokens,
            maxLatentBytes: maxLatentBytes,
            maxPayloadBytes: maxPayloadBytes
        )
    }

    /// Independent, deterministic capture-to-codec validation seam.
    /// This does NOT claim that its caller generated the supplied vectors.
    /// When used with a fixture/mock, the output is only a test artifact.
    public static func encodeCaptured(
        _ captured: LlamaLatentSequenceOutput,
        expectedModelIdentity: NativeLatentModelIdentity,
        codebookArtifact: Data,
        expectedCodebookSHA256: String,
        maxLatentTokens: Int = maximumLatentTokens,
        maxLatentBytes: Int = maximumLatentBytes,
        maxPayloadBytes: Int = maximumPayloadBytes
    ) throws -> NativeGIEEncodedGeneration {
        guard maxLatentTokens > 0, maxLatentTokens <= maximumLatentTokens,
              maxLatentBytes > 0, maxLatentBytes <= maximumLatentBytes,
              maxPayloadBytes > 0, maxPayloadBytes <= maximumPayloadBytes else {
            throw NativeGIECaptureError.invalidCaptureBounds
        }
        let codebook = try NativeGIECodebookArtifact.load(
            codebookArtifact,
            expectedSHA256: expectedCodebookSHA256,
            expectedModelIdentity: expectedModelIdentity
        )
        let encoder = try NativeGIESequenceEncoder(codebook: codebook)
        guard maxPayloadBytes >= encoder.minimumPayloadByteLength else {
            throw NativeGIECaptureError.payloadTooLarge
        }
        return try encodeValidated(
            captured,
            expectedModelIdentity: expectedModelIdentity,
            encoder: encoder,
            providerKind: .other, // Caller-supplied vectors cannot attest a provider.
            maxLatentTokens: maxLatentTokens,
            maxLatentBytes: maxLatentBytes,
            maxPayloadBytes: maxPayloadBytes
        )
    }

    private static func encodeValidated(
        _ captured: LlamaLatentSequenceOutput,
        expectedModelIdentity: NativeLatentModelIdentity,
        encoder: NativeGIESequenceEncoder,
        providerKind: NativeInferenceProviderKind,
        maxLatentTokens: Int,
        maxLatentBytes: Int,
        maxPayloadBytes: Int
    ) throws -> NativeGIEEncodedGeneration {
        guard captured.modelId.utf8.elementsEqual(expectedModelIdentity.modelId.utf8) else {
            throw NativeGIECaptureError.modelIdentityMismatch
        }
        let (elements, overflow) = captured.tokenCount.multipliedReportingOverflow(by: captured.embeddingDimension)
        guard !overflow,
              captured.tokenCount > 0, captured.tokenCount <= maxLatentTokens,
              captured.embeddingDimension > 0, captured.embeddingDimension <= 8_192,
              elements == captured.embeddings.count,
              elements <= maxLatentBytes / MemoryLayout<Float>.size,
              captured.shape == [captured.tokenCount, captured.embeddingDimension],
              captured.embeddings.allSatisfy(\.isFinite) else {
            throw NativeGIECaptureError.invalidCaptureBounds
        }
        let payload = try encoder.encode(
            tokenEmbeddings: captured.embeddings,
            tokenCount: captured.tokenCount,
            embeddingDimension: captured.embeddingDimension,
            modelIdentity: expectedModelIdentity
        )
        guard payload.count <= maxPayloadBytes else {
            throw NativeGIECaptureError.payloadTooLarge
        }
        try Task.checkCancellation()
        return NativeGIEEncodedGeneration(
            modelIdentity: expectedModelIdentity,
            providerKind: providerKind,
            text: captured.text,
            tokenCount: captured.tokenCount,
            embeddingDimension: captured.embeddingDimension,
            codebookSHA256: encoder.codebook.codebookId,
            payload: payload
        )
    }
}

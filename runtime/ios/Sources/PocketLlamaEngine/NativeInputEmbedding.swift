import Foundation

/// Hard bounds for the experimental raw model-input evaluation boundary.
public enum NativeInputEmbeddingLimits {
    public static let maxTokenCount = 256
    public static let maxDimension = 8_192
    public static let maxInputBytes = 16 * 1024 * 1024
    public static let maxLogitCount = 262_144
}

/// Capabilities reported by one loaded engine session, not by routing metadata.
/// These bounds describe numerical input support; they do not establish a
/// mapping from final-layer activations or GIE pooled vectors into model inputs.
public struct NativeInputEmbeddingCapabilities: Sendable, Equatable {
    public let modelId: String
    public let inputDimension: Int
    public let vocabularySize: Int
    public let maxTokenCount: Int
    public let maxInputBytes: Int

    public init(
        modelId: String,
        inputDimension: Int,
        vocabularySize: Int,
        maxTokenCount: Int,
        maxInputBytes: Int
    ) {
        self.modelId = modelId
        self.inputDimension = inputDimension
        self.vocabularySize = vocabularySize
        self.maxTokenCount = maxTokenCount
        self.maxInputBytes = maxInputBytes
    }
}

/// An explicit sequence in the loaded model's first-layer input space.
///
/// `embeddings` is row-major with shape [tokenCount, embeddingDimension]. The
/// engine evaluates these rows directly from position zero, without a text
/// prompt or token-embedding lookup. Callers must supply the intended input
/// representation; matching dimensions do not make final-layer output or GIE
/// pooled segment vectors compatible. This type grants no agent authority.
public struct NativeInputEmbeddingRequest: Sendable, Equatable {
    public let requestId: UUID
    public let modelId: String
    public let tokenCount: Int
    public let embeddingDimension: Int
    public let embeddings: [Float]

    public init(
        requestId: UUID = UUID(),
        modelId: String,
        tokenCount: Int,
        embeddingDimension: Int,
        embeddings: [Float]
    ) {
        self.requestId = requestId
        self.modelId = modelId
        self.tokenCount = tokenCount
        self.embeddingDimension = embeddingDimension
        self.embeddings = embeddings
    }
}

/// Vocabulary logits at the final supplied input position, before sampling.
/// This numerical result is not a generated message or a GIE compatibility claim.
public struct NativeInputEmbeddingEvaluationResult: Sendable, Equatable {
    public let requestId: UUID
    public let modelId: String
    public let tokenCount: Int
    public let embeddingDimension: Int
    public let logits: [Float]

    public init(
        requestId: UUID,
        modelId: String,
        tokenCount: Int,
        embeddingDimension: Int,
        logits: [Float]
    ) {
        self.requestId = requestId
        self.modelId = modelId
        self.tokenCount = tokenCount
        self.embeddingDimension = embeddingDimension
        self.logits = logits
    }
}

/// Optional, experimental access to the real model-input boundary.
/// Ordinary text generation remains available through `LlamaEngine`.
public protocol InputEmbeddingEvaluatingLlamaEngine: LlamaEngine {
    func inputEmbeddingCapabilities(
        session: RuntimeSession
    ) async throws -> NativeInputEmbeddingCapabilities

    func evaluateInputEmbeddings(
        session: RuntimeSession,
        request: NativeInputEmbeddingRequest
    ) async throws -> NativeInputEmbeddingEvaluationResult
}

/// Shared preflight and result checks for the runtime and native backend.
/// Identity uses bytes because Swift String equality accepts canonically
/// equivalent Unicode spellings that are distinct model identifiers here.
enum NativeInputEmbeddingValidation {
    static func modelIDsMatch(_ lhs: String, _ rhs: String) -> Bool {
        lhs.utf8.elementsEqual(rhs.utf8)
    }

    static func validateRequest(_ request: NativeInputEmbeddingRequest) throws {
        guard !request.modelId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              (1...NativeInputEmbeddingLimits.maxTokenCount).contains(request.tokenCount),
              (1...NativeInputEmbeddingLimits.maxDimension).contains(request.embeddingDimension) else {
            throw NativeInferenceRuntimeError.invalidInputEmbeddingRequest
        }
        let (elementCount, overflow) = request.tokenCount.multipliedReportingOverflow(by: request.embeddingDimension)
        guard !overflow,
              elementCount == request.embeddings.count,
              elementCount <= NativeInputEmbeddingLimits.maxInputBytes / MemoryLayout<Float>.size,
              request.embeddings.allSatisfy(\.isFinite) else {
            throw NativeInferenceRuntimeError.invalidInputEmbeddingRequest
        }
    }

    static func validateCapabilities(
        _ capabilities: NativeInputEmbeddingCapabilities,
        expectedModelId: String
    ) throws {
        guard !capabilities.modelId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              modelIDsMatch(capabilities.modelId, expectedModelId),
              (1...NativeInputEmbeddingLimits.maxDimension).contains(capabilities.inputDimension),
              (1...NativeInputEmbeddingLimits.maxLogitCount).contains(capabilities.vocabularySize),
              (1...NativeInputEmbeddingLimits.maxTokenCount).contains(capabilities.maxTokenCount),
              capabilities.maxInputBytes > 0,
              capabilities.maxInputBytes <= NativeInputEmbeddingLimits.maxInputBytes,
              capabilities.inputDimension <= capabilities.maxInputBytes / MemoryLayout<Float>.size else {
            throw NativeInferenceRuntimeError.invalidInputEmbeddingCapabilities
        }
    }

    static func validateRequest(
        _ request: NativeInputEmbeddingRequest,
        capabilities: NativeInputEmbeddingCapabilities
    ) throws {
        try validateRequest(request)
        guard modelIDsMatch(request.modelId, capabilities.modelId),
              request.embeddingDimension == capabilities.inputDimension,
              request.tokenCount <= capabilities.maxTokenCount,
              request.embeddings.count <= capabilities.maxInputBytes / MemoryLayout<Float>.size else {
            throw NativeInferenceRuntimeError.invalidInputEmbeddingRequest
        }
    }

    static func validateResult(
        _ result: NativeInputEmbeddingEvaluationResult,
        request: NativeInputEmbeddingRequest,
        capabilities: NativeInputEmbeddingCapabilities
    ) throws {
        guard result.requestId == request.requestId,
              modelIDsMatch(result.modelId, request.modelId),
              modelIDsMatch(result.modelId, capabilities.modelId),
              result.tokenCount == request.tokenCount,
              result.embeddingDimension == request.embeddingDimension,
              result.logits.count == capabilities.vocabularySize,
              result.logits.count > 0,
              result.logits.count <= NativeInputEmbeddingLimits.maxLogitCount,
              result.logits.allSatisfy(\.isFinite) else {
            throw NativeInferenceRuntimeError.invalidInputEmbeddingOutput
        }
    }
}

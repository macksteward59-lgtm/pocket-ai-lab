import Foundation
#if POCKET_LLAMA_LINKED
import LlamaCppBridge
#endif

/// Local inference boundary for Pocket AI Lab on iOS.
///
/// Model text is untrusted. Nothing in this file grants APEX authorization.
/// `PlaceholderLlamaEngine` always fails closed. `LlamaCppMetalBackend` returns
/// text only when the linked llama.cpp build produced it. A missing library,
/// an unusable Metal device, or an empty decode throws `LlamaEngineError` and
/// yields no token.

public enum LlamaEngineError: Error, Equatable, Sendable {
    case backendUnavailable(String)
    case invalidModel(String)
    case invalidRequest(String)
    case remoteEndpointRejected(String)
    case sessionNotLoaded(String)
    case cancelled
    case backendFailed(String)
}

public struct ModelDescriptor: Sendable, Codable, Equatable {
    public let id: String
    public let name: String
    public let path: String
    public let contextLength: Int
    public let quantization: String?

    public init(id: String, name: String, path: String, contextLength: Int, quantization: String? = nil) {
        self.id = id
        self.name = name
        self.path = path
        self.contextLength = contextLength
        self.quantization = quantization
    }
}

public struct RuntimeSession: Sendable, Equatable {
    public let id: String
    public let modelId: String

    public init(id: String, modelId: String) {
        self.id = id
        self.modelId = modelId
    }
}

public struct GenerationRequest: Sendable, Equatable {
    /// Stable request identity used to prevent stale cancellation from affecting a newer decode.
    public let requestId: String
    public let prompt: String
    public let maxTokens: Int
    public let temperature: Double

    public init(requestId: String = UUID().uuidString, prompt: String, maxTokens: Int, temperature: Double) {
        self.requestId = requestId
        self.prompt = prompt
        self.maxTokens = maxTokens
        self.temperature = temperature
    }
}

public struct Token: Sendable, Equatable {
    public let text: String
    public let isComplete: Bool

    public init(text: String, isComplete: Bool) {
        self.text = text
        self.isComplete = isComplete
    }
}

/// Text plus the final generated token's last-layer output embedding.
/// This is not a dump of every transformer layer's hidden states.
public struct LlamaLatentOutput: Sendable, Equatable {
    public let modelId: String
    public let text: String
    public let embedding: [Float]
    public let shape: [Int]

    public init(modelId: String, text: String, embedding: [Float]) {
        self.modelId = modelId
        self.text = text
        self.embedding = embedding
        self.shape = [embedding.count]
    }
}

/// Ordered generated-token output embeddings captured from one inference request.
public struct LlamaLatentSequenceOutput: Sendable, Equatable {
    public let modelId: String
    public let text: String
    /// Row-major generated-token embeddings with shape [tokenCount, embeddingDimension].
    public let embeddings: [Float]
    public let tokenCount: Int
    public let embeddingDimension: Int
    public var shape: [Int] { [tokenCount, embeddingDimension] }

    public init(modelId: String, text: String, embeddings: [Float], tokenCount: Int, embeddingDimension: Int) {
        self.modelId = modelId
        self.text = text
        self.embeddings = embeddings
        self.tokenCount = tokenCount
        self.embeddingDimension = embeddingDimension
    }
}

/// What the linked llama.cpp build reported. `offloadedLayers` is -1 when llama.cpp did not log an offload line.
public struct LlamaOffloadReport: Sendable, Equatable {
    public let metalDeviceUsableAtLoad: Bool
    public let requestedGpuLayers: Int
    public let offloadedLayers: Int
    public let reportedLayerCount: Int

    public var usedGpuOffload: Bool { offloadedLayers > 0 }
}

/// Probe of the process that loaded this build. It does not create a session and it does not generate text.
public struct LlamaCppProbe: Sendable, Equatable {
    public let linked: Bool
    public let metalBackendRegistered: Bool
    public let metalDeviceUsable: Bool
    public let gpuDeviceCount: Int
    public let version: String
    public let pinTag: String
    public let pinCommit: String
    public let systemInfo: String
    public let metalDeviceDescription: String
}

public protocol LlamaEngine: Sendable {
    func load(model: ModelDescriptor) async throws -> RuntimeSession
    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error>
    func cancel(sessionId: String, requestId: String) async
    /// Requests cancellation and waits until the matching native generation has drained.
    func cancelAndWait(sessionId: String, requestId: String) async
    func unload(sessionId: String) async
}

/// Optional capability for runtimes that can export a final-token output embedding. Ordinary text generation remains the default.
public protocol LatentExportingLlamaEngine: LlamaEngine {
    func generateWithLatent(session: RuntimeSession, request: GenerationRequest) async throws -> LlamaLatentOutput
}

/// Optional capability for bounded, ordered generated-token embedding sequences.
public protocol LatentSequenceExportingLlamaEngine: LatentExportingLlamaEngine {
    func generateWithLatentSequence(
        session: RuntimeSession,
        request: GenerationRequest,
        maxLatentTokens: Int,
        maxLatentBytes: Int
    ) async throws -> LlamaLatentSequenceOutput
}

/// No backend is linked. Load and generate refuse instead of inventing a session or tokens.
public actor PlaceholderLlamaEngine: LlamaEngine {
    public init() {}

    public func load(model: ModelDescriptor) async throws -> RuntimeSession {
        throw LlamaEngineError.backendUnavailable("No inference backend is linked. Refusing to invent a session.")
    }

    public func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        throw LlamaEngineError.backendUnavailable("No inference backend is linked. Refusing to invent tokens.")
    }

    public func generateWithLatent(session: RuntimeSession, request: GenerationRequest) async throws -> LlamaLatentOutput {
        throw LlamaEngineError.backendUnavailable("The placeholder engine cannot export latent representations.")
    }

    public func cancel(sessionId: String, requestId: String) async {}

    public func cancelAndWait(sessionId: String, requestId: String) async {}

    public func unload(sessionId: String) async {}
}

/// llama.cpp with the Metal backend compiled in.
///
/// `requireMetal` is the default. When this process cannot create a Metal backend,
/// load throws `backendUnavailable` and does not read the model into a session.
/// Pass `requireMetal: false` only for an explicit CPU run. CPU text is still llama.cpp
/// output. This engine yields one completed string, not a fabricated partial.
public actor LlamaCppMetalBackend: LatentSequenceExportingLlamaEngine {
    private let requireMetal: Bool
    private let treatMetalAsUnavailable: Bool
    #if POCKET_LLAMA_LINKED
    private var sessions: [String: LoadedSession] = [:]
    #endif
    private var reports: [String: LlamaOffloadReport] = [:]
    private var generation: [String: UUID] = [:]
    private var generationTasks: [String: (requestId: String, task: Task<Void, Never>)] = [:]
    #if POCKET_LLAMA_LINKED
    private var latentGenerationTasks: [String: (requestId: String, task: Task<LlamaLatentOutput, Error>)] = [:]
    private var latentSequenceTasks: [String: (requestId: String, task: Task<LlamaLatentSequenceOutput, Error>)] = [:]
    #endif

    public init(requireMetal: Bool = true) {
        self.requireMetal = requireMetal
        self.treatMetalAsUnavailable = false
    }

    /// Test seam. It can only force the unavailable failure. It cannot invent text.
    internal init(requireMetal: Bool, treatMetalAsUnavailable: Bool) {
        self.requireMetal = requireMetal
        self.treatMetalAsUnavailable = treatMetalAsUnavailable
    }

    public static func probe() -> LlamaCppProbe {
        #if POCKET_LLAMA_LINKED
        var registered: Int32 = 0
        var usable: Int32 = 0
        var gpus: Int32 = 0
        let versionBuf = UnsafeMutablePointer<CChar>.allocate(capacity: 256)
        let infoBuf = UnsafeMutablePointer<CChar>.allocate(capacity: 1024)
        let descBuf = UnsafeMutablePointer<CChar>.allocate(capacity: 256)
        versionBuf.initialize(repeating: 0, count: 256)
        infoBuf.initialize(repeating: 0, count: 1024)
        descBuf.initialize(repeating: 0, count: 256)
        defer {
            versionBuf.deallocate()
            infoBuf.deallocate()
            descBuf.deallocate()
        }
        _ = pocket_llama_probe(
            &registered,
            &usable,
            &gpus,
            versionBuf,
            256,
            infoBuf,
            1024,
            descBuf,
            256
        )
        let version = String(cString: versionBuf)
        let systemInfo = String(cString: infoBuf)
        let description = String(cString: descBuf)
        return LlamaCppProbe(
            linked: pocket_llama_linked() == 1,
            metalBackendRegistered: registered == 1,
            metalDeviceUsable: usable == 1,
            gpuDeviceCount: Int(gpus),
            version: version,
            pinTag: String(cString: pocket_llama_pin_tag()),
            pinCommit: String(cString: pocket_llama_pin_commit()),
            systemInfo: systemInfo,
            metalDeviceDescription: description
        )
        #else
        return LlamaCppProbe(
            linked: false,
            metalBackendRegistered: false,
            metalDeviceUsable: false,
            gpuDeviceCount: 0,
            version: "",
            pinTag: "",
            pinCommit: "",
            systemInfo: "",
            metalDeviceDescription: ""
        )
        #endif
    }

    public func offloadReport(sessionId: String) -> LlamaOffloadReport? {
        reports[sessionId]
    }

    public func load(model: ModelDescriptor) async throws -> RuntimeSession {
        #if POCKET_LLAMA_LINKED
        guard pocket_llama_linked() == 1 else {
            throw LlamaEngineError.backendUnavailable("llama.cpp Metal is not linked in this build. No session was created.")
        }
        try LlamaEngineSupport.validateModel(model)
        let probe = Self.probe()
        if treatMetalAsUnavailable || (requireMetal && !probe.metalDeviceUsable) {
            throw LlamaEngineError.backendUnavailable("llama.cpp Metal is not available in this process. No session was created.")
        }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: model.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            throw LlamaEngineError.invalidModel("The model file does not exist. No session was created.")
        }
        let gpuLayers: Int32 = requireMetal ? -1 : 0
        let loaded = try LoadedSession.open(
            model: model,
            gpuLayers: gpuLayers,
            metalDeviceUsable: probe.metalDeviceUsable
        )
        let runtime = RuntimeSession(id: UUID().uuidString, modelId: model.id)
        sessions[runtime.id] = loaded
        reports[runtime.id] = loaded.report
        return runtime
        #else
        throw LlamaEngineError.backendUnavailable("llama.cpp Metal is not linked in this build. No session was created.")
        #endif
    }

    public func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        #if !POCKET_LLAMA_LINKED
        throw LlamaEngineError.backendUnavailable("llama.cpp Metal is not linked in this build. No tokens were produced.")
        #else
        try LlamaEngineSupport.validateRequest(request)
        guard sessions[session.id] != nil else {
            throw LlamaEngineError.sessionNotLoaded("Session \(session.id) is not loaded.")
        }
        guard generation[session.id] == nil else {
            throw LlamaEngineError.invalidRequest("This runtime session already has an active generation. Cancel or finish it before starting another.")
        }
        guard let token = UUID(uuidString: request.requestId) else {
            throw LlamaEngineError.invalidRequest("Generation request ID must be a UUID.")
        }
        generation[session.id] = token
        let slot = TaskSlot()
        let stream = AsyncThrowingStream<Token, Error> { continuation in
            let task = Task {
                do {
                    let text = try await self.generateText(sessionId: session.id, request: request)
                    guard await self.isCurrent(session.id, token) else {
                        await self.finishGeneration(sessionId: session.id, token: token)
                        continuation.finish(throwing: LlamaEngineError.cancelled)
                        return
                    }
                    continuation.yield(Token(text: text, isComplete: true))
                    await self.finishGeneration(sessionId: session.id, token: token)
                    continuation.finish()
                } catch {
                    await self.finishGeneration(sessionId: session.id, token: token)
                    continuation.finish(throwing: error)
                }
            }
            slot.task = task
            continuation.onTermination = { @Sendable _ in
                task.cancel()
                Task { await self.cancelAndWait(sessionId: session.id, requestId: token.uuidString) }
            }
        }
        if let task = slot.task {
            generationTasks[session.id] = (requestId: token.uuidString, task: task)
        }
        return stream
        #endif
    }

    /// Generates text and copies the final token embedding while retaining the exact native session.
    public func generateWithLatent(session: RuntimeSession, request: GenerationRequest) async throws -> LlamaLatentOutput {
        #if !POCKET_LLAMA_LINKED
        throw LlamaEngineError.backendUnavailable("llama.cpp Metal is not linked in this build. No latent representation was produced.")
        #else
        try LlamaEngineSupport.validateRequest(request)
        guard let loaded = sessions[session.id] else {
            throw LlamaEngineError.sessionNotLoaded("Session \\(session.id) is not loaded.")
        }
        guard generation[session.id] == nil else {
            throw LlamaEngineError.invalidRequest("This runtime session already has an active generation. Cancel or finish it before starting another.")
        }
        guard let token = UUID(uuidString: request.requestId) else {
            throw LlamaEngineError.invalidRequest("Generation request ID must be a UUID.")
        }
        generation[session.id] = token
        let task = Task.detached {
            try loaded.generateWithLatent(request, modelId: session.modelId)
        }
        latentGenerationTasks[session.id] = (requestId: token.uuidString, task: task)
        do {
            let result = try await withTaskCancellationHandler {
                try await task.value
            } onCancel: {
                Task { await self.cancelAndWait(sessionId: session.id, requestId: token.uuidString) }
            }
            guard generation[session.id] == token else {
                throw LlamaEngineError.cancelled
            }
            finishGeneration(sessionId: session.id, token: token)
            return result
        } catch {
            finishGeneration(sessionId: session.id, token: token)
            throw error
        }
        #endif
    }

    public func generateWithLatentSequence(
        session: RuntimeSession,
        request: GenerationRequest,
        maxLatentTokens: Int = 256,
        maxLatentBytes: Int = 16 * 1024 * 1024
    ) async throws -> LlamaLatentSequenceOutput {
        #if !POCKET_LLAMA_LINKED
        throw LlamaEngineError.backendUnavailable("llama.cpp Metal is not linked in this build. No latent sequence was produced.")
        #else
        try LlamaEngineSupport.validateRequest(request)
        guard maxLatentTokens > 0, maxLatentTokens <= 256,
              maxLatentBytes > 0, maxLatentBytes <= 16 * 1024 * 1024,
              request.maxTokens <= maxLatentTokens else {
            throw LlamaEngineError.invalidRequest("Latent sequence limits are invalid or smaller than the requested generation.")
        }
        guard let loaded = sessions[session.id] else {
            throw LlamaEngineError.sessionNotLoaded("Session \(session.id) is not loaded.")
        }
        guard generation[session.id] == nil else {
            throw LlamaEngineError.invalidRequest("This runtime session already has an active generation.")
        }
        guard let token = UUID(uuidString: request.requestId) else {
            throw LlamaEngineError.invalidRequest("Generation request ID must be a UUID.")
        }
        generation[session.id] = token
        let task = Task.detached {
            try loaded.generateWithLatentSequence(
                request,
                modelId: session.modelId,
                maxTokens: maxLatentTokens,
                maxBytes: maxLatentBytes
            )
        }
        latentSequenceTasks[session.id] = (requestId: token.uuidString, task: task)
        do {
            let result = try await withTaskCancellationHandler {
                try await task.value
            } onCancel: {
                Task { await self.cancelAndWait(sessionId: session.id, requestId: token.uuidString) }
            }
            guard generation[session.id] == token else { throw LlamaEngineError.cancelled }
            finishGeneration(sessionId: session.id, token: token)
            return result
        } catch {
            finishGeneration(sessionId: session.id, token: token)
            throw error
        }
        #endif
    }

    public func cancel(sessionId: String, requestId: String) async {
        guard let active = generation[sessionId],
              active.uuidString.caseInsensitiveCompare(requestId) == .orderedSame else {
            // A stale or unrelated request must never cancel a newer generation.
            return
        }
        generation[sessionId] = nil
        #if POCKET_LLAMA_LINKED
        sessions[sessionId]?.requestCancel()
        #endif
    }

    public func cancelAndWait(sessionId: String, requestId: String) async {
        if let active = generationTasks[sessionId],
           active.requestId.caseInsensitiveCompare(requestId) == .orderedSame {
            await cancel(sessionId: sessionId, requestId: requestId)
            await active.task.value
            return
        }
        #if POCKET_LLAMA_LINKED
        if let active = latentGenerationTasks[sessionId],
           active.requestId.caseInsensitiveCompare(requestId) == .orderedSame {
            await cancel(sessionId: sessionId, requestId: requestId)
            _ = try? await active.task.value
            return
        }
        if let active = latentSequenceTasks[sessionId],
           active.requestId.caseInsensitiveCompare(requestId) == .orderedSame {
            await cancel(sessionId: sessionId, requestId: requestId)
            _ = try? await active.task.value
        }
        #endif
    }

    public func unload(sessionId: String) async {
        if let active = generationTasks[sessionId] {
            await cancelAndWait(sessionId: sessionId, requestId: active.requestId)
        }
        #if POCKET_LLAMA_LINKED
        if let active = latentGenerationTasks[sessionId] {
            await cancelAndWait(sessionId: sessionId, requestId: active.requestId)
        }
        if let active = latentSequenceTasks[sessionId] {
            await cancelAndWait(sessionId: sessionId, requestId: active.requestId)
        }
        #endif
        generation[sessionId] = nil
        generationTasks[sessionId] = nil
        #if POCKET_LLAMA_LINKED
        latentGenerationTasks[sessionId] = nil
        latentSequenceTasks[sessionId] = nil
        #endif
        reports[sessionId] = nil
        #if POCKET_LLAMA_LINKED
        let loaded = sessions.removeValue(forKey: sessionId)
        loaded?.close()
        #endif
    }

    private func isCurrent(_ sessionId: String, _ token: UUID) -> Bool {
        generation[sessionId] == token
    }

    private func finishGeneration(sessionId: String, token: UUID) {
        if generation[sessionId] == token {
            generation[sessionId] = nil
        }
        if generationTasks[sessionId]?.requestId.caseInsensitiveCompare(token.uuidString) == .orderedSame {
            generationTasks[sessionId] = nil
        }
        #if POCKET_LLAMA_LINKED
        if latentGenerationTasks[sessionId]?.requestId.caseInsensitiveCompare(token.uuidString) == .orderedSame {
            latentGenerationTasks[sessionId] = nil
        }
        if latentSequenceTasks[sessionId]?.requestId.caseInsensitiveCompare(token.uuidString) == .orderedSame {
            latentSequenceTasks[sessionId] = nil
        }
        #endif
    }

    #if POCKET_LLAMA_LINKED
    private func generateText(sessionId: String, request: GenerationRequest) async throws -> String {
        guard let loaded = sessions[sessionId] else {
            throw LlamaEngineError.sessionNotLoaded("Session \(sessionId) is not loaded.")
        }
        return try await Task.detached {
            try loaded.generate(request)
        }.value
    }
    #endif
}

#if POCKET_LLAMA_LINKED
private final class LoadedSession: @unchecked Sendable {
    let report: LlamaOffloadReport
    private let handle: OpaquePointer
    private let lock = NSLock()
    private var alive = true

    private init(handle: OpaquePointer, report: LlamaOffloadReport) {
        self.handle = handle
        self.report = report
    }

    static func open(model: ModelDescriptor, gpuLayers: Int32, metalDeviceUsable: Bool) throws -> LoadedSession {
        var err = [CChar](repeating: 0, count: 768)
        var handle: OpaquePointer?
        let rc = err.withUnsafeMutableBufferPointer { buffer in
            pocket_llama_load(
                model.path,
                Int32(model.contextLength),
                gpuLayers,
                &handle,
                buffer.baseAddress,
                buffer.count
            )
        }
        guard rc == POCKET_LLAMA_OK, let handle else {
            throw Self.map(rc, err)
        }
        var requested: Int32 = 0
        var layers: Int32 = -1
        var total: Int32 = -1
        pocket_llama_offload(handle, &requested, &layers, &total)
        let report = LlamaOffloadReport(
            metalDeviceUsableAtLoad: metalDeviceUsable,
            requestedGpuLayers: Int(requested),
            offloadedLayers: Int(layers),
            reportedLayerCount: Int(total)
        )
        return LoadedSession(handle: handle, report: report)
    }

    func generate(_ request: GenerationRequest) throws -> String {
        lock.lock()
        defer { lock.unlock() }
        guard alive else {
            throw LlamaEngineError.sessionNotLoaded("Session is not loaded.")
        }
        return try generateLocked(request)
    }

    func generateWithLatent(_ request: GenerationRequest, modelId: String) throws -> LlamaLatentOutput {
        lock.lock()
        defer { lock.unlock() }
        guard alive else {
            throw LlamaEngineError.sessionNotLoaded("Session is not loaded.")
        }

        try setEmbeddingCapture(true)
        defer { try? setEmbeddingCapture(false) }
        let text = try generateLocked(request)
        var required: Int = 0
        var err = [CChar](repeating: 0, count: 768)
        let queryRC = err.withUnsafeMutableBufferPointer { errBuffer in
            pocket_llama_copy_last_embedding(
                handle,
                nil,
                0,
                &required,
                errBuffer.baseAddress,
                errBuffer.count
            )
        }
        guard queryRC == POCKET_LLAMA_OK, required > 0, required <= 65_536 else {
            throw Self.map(queryRC, err)
        }

        var embedding = [Float](repeating: 0, count: required)
        var copied: Int = 0
        let copyRC = embedding.withUnsafeMutableBufferPointer { outputBuffer in
            err.withUnsafeMutableBufferPointer { errBuffer in
                pocket_llama_copy_last_embedding(
                    handle,
                    outputBuffer.baseAddress,
                    outputBuffer.count,
                    &copied,
                    errBuffer.baseAddress,
                    errBuffer.count
                )
            }
        }
        guard copyRC == POCKET_LLAMA_OK, copied == required else {
            throw Self.map(copyRC, err)
        }
        guard embedding.allSatisfy(\.isFinite) else {
            throw LlamaEngineError.backendFailed("The final-token embedding contained non-finite values.")
        }
        return LlamaLatentOutput(modelId: modelId, text: text, embedding: embedding)
    }

    func generateWithLatentSequence(
        _ request: GenerationRequest,
        modelId: String,
        maxTokens: Int,
        maxBytes: Int
    ) throws -> LlamaLatentSequenceOutput {
        lock.lock()
        defer { lock.unlock() }
        guard alive else {
            throw LlamaEngineError.sessionNotLoaded("Session is not loaded.")
        }
        guard maxTokens > 0, maxTokens <= 256, maxBytes > 0, maxBytes <= 16 * 1024 * 1024,
              request.maxTokens <= maxTokens else {
            throw LlamaEngineError.invalidRequest("Latent sequence limits are invalid or smaller than the requested generation.")
        }
        try setSequenceCapture(maxTokens: maxTokens, maxBytes: maxBytes)
        defer { try? setSequenceCapture(maxTokens: 0, maxBytes: 0) }
        let text = try generateLocked(request)

        var tokenCount = 0
        var dimension = 0
        var err = [CChar](repeating: 0, count: 768)
        let queryRC = err.withUnsafeMutableBufferPointer { errBuffer in
            pocket_llama_copy_embedding_sequence(
                handle, nil, 0, &tokenCount, &dimension, errBuffer.baseAddress, errBuffer.count
            )
        }
        guard queryRC == POCKET_LLAMA_OK, tokenCount > 0, dimension > 0,
              tokenCount <= maxTokens,
              tokenCount <= Int.max / dimension,
              tokenCount * dimension <= maxBytes / MemoryLayout<Float>.size else {
            throw Self.map(queryRC, err)
        }

        var embeddings = [Float](repeating: 0, count: tokenCount * dimension)
        var copiedTokens = 0
        var copiedDimension = 0
        let copyRC = embeddings.withUnsafeMutableBufferPointer { outputBuffer in
            err.withUnsafeMutableBufferPointer { errBuffer in
                pocket_llama_copy_embedding_sequence(
                    handle,
                    outputBuffer.baseAddress,
                    outputBuffer.count,
                    &copiedTokens,
                    &copiedDimension,
                    errBuffer.baseAddress,
                    errBuffer.count
                )
            }
        }
        guard copyRC == POCKET_LLAMA_OK,
              copiedTokens == tokenCount, copiedDimension == dimension,
              embeddings.allSatisfy(\\.isFinite) else {
            throw Self.map(copyRC, err)
        }
        return LlamaLatentSequenceOutput(
            modelId: modelId,
            text: text,
            embeddings: embeddings,
            tokenCount: tokenCount,
            embeddingDimension: dimension
        )
    }

    private func setSequenceCapture(maxTokens: Int, maxBytes: Int) throws {
        var err = [CChar](repeating: 0, count: 768)
        let rc = err.withUnsafeMutableBufferPointer { errBuffer in
            pocket_llama_set_sequence_capture(
                handle,
                maxTokens,
                maxBytes,
                errBuffer.baseAddress,
                errBuffer.count
            )
        }
        guard rc == POCKET_LLAMA_OK else { throw Self.map(rc, err) }
    }

    private func setEmbeddingCapture(_ enabled: Bool) throws {
        var err = [CChar](repeating: 0, count: 768)
        let rc = err.withUnsafeMutableBufferPointer { errBuffer in
            pocket_llama_set_embeddings(
                handle,
                enabled ? 1 : 0,
                errBuffer.baseAddress,
                errBuffer.count
            )
        }
        guard rc == POCKET_LLAMA_OK else {
            throw Self.map(rc, err)
        }
    }

    private func generateLocked(_ request: GenerationRequest) throws -> String {
        let capacity = min(262144, max(64, request.maxTokens * 16 + 64))
        var out = [CChar](repeating: 0, count: capacity)
        var err = [CChar](repeating: 0, count: 768)
        let rc = out.withUnsafeMutableBufferPointer { outBuffer in
            err.withUnsafeMutableBufferPointer { errBuffer in
                pocket_llama_generate(
                    handle,
                    request.prompt,
                    Int32(request.maxTokens),
                    Float(request.temperature),
                    outBuffer.baseAddress,
                    outBuffer.count,
                    errBuffer.baseAddress,
                    errBuffer.count
                )
            }
        }
        guard rc == POCKET_LLAMA_OK else {
            throw Self.map(rc, err)
        }
        let text = String(cString: out)
        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw LlamaEngineError.backendFailed("llama.cpp returned empty text. No token was invented.")
        }
        return text
    }

    func requestCancel() {
        pocket_llama_request_cancel(handle)
    }

    func close() {
        pocket_llama_request_cancel(handle)
        lock.lock()
        if alive {
            alive = false
            pocket_llama_free(handle)
        }
        lock.unlock()
    }

    private static func map(_ rc: Int32, _ err: [CChar]) -> LlamaEngineError {
        let message = String(cString: err)
        let text = message.isEmpty ? "llama.cpp failed." : message
        switch rc {
        case POCKET_LLAMA_ERR_NOT_LINKED:
            return .backendUnavailable(text)
        case POCKET_LLAMA_ERR_CANCELLED:
            return .cancelled
        case POCKET_LLAMA_ERR_ARGS, POCKET_LLAMA_ERR_PROMPT:
            return .invalidRequest(text)
        case POCKET_LLAMA_ERR_MODEL:
            return .backendFailed(text)
        default:
            return .backendFailed(text)
        }
    }
}
#endif

/// Optional client for a llama-server that is already running on this machine.
/// It does not orchestrate agents and it does not treat the completion as authorization.
public actor LoopbackLlamaEngine: LlamaEngine {
    private let baseURL: URL
    private let session: URLSession
    private var loaded: [String: RuntimeSession] = [:]
    private var generation: [String: UUID] = [:]
    private var requestIds: [String: String] = [:]
    private var tasks: [String: Task<Void, Never>] = [:]

    public init(baseURL: URL, session: URLSession? = nil) throws {
        self.baseURL = try LlamaEngineSupport.validateLoopbackBaseURL(baseURL)
        self.session = session ?? LoopbackLlamaEngine.makeSession()
    }

    public func load(model: ModelDescriptor) async throws -> RuntimeSession {
        try LlamaEngineSupport.validateModel(model)
        let healthURL = baseURL.appendingPathComponent("health")
        let (data, response) = try await data(from: healthURL, method: "GET", body: nil)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, LlamaEngineSupport.healthIsReady(data) else {
            throw LlamaEngineError.backendFailed("llama-server health check did not report status ok.")
        }
        let runtime = RuntimeSession(id: UUID().uuidString, modelId: model.id)
        loaded[runtime.id] = runtime
        return runtime
    }

    public func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        guard loaded[session.id] != nil else {
            throw LlamaEngineError.sessionNotLoaded("Session \(session.id) is not loaded.")
        }
        try LlamaEngineSupport.validateRequest(request)
        let url = baseURL.appendingPathComponent("completion")
        let body = try LlamaEngineSupport.completionBody(
            prompt: request.prompt,
            maxTokens: request.maxTokens,
            temperature: request.temperature
        )
        let token = UUID()
        generation[session.id] = token
        requestIds[session.id] = request.requestId
        let slot = TaskSlot()
        let stream = AsyncThrowingStream<Token, Error> { continuation in
            let task = Task {
                do {
                    try Task.checkCancellation()
                    let (data, response) = try await self.data(from: url, method: "POST", body: body)
                    try Task.checkCancellation()
                    guard await self.isCurrent(session.id, token) else {
                        throw LlamaEngineError.cancelled
                    }
                    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                        throw LlamaEngineError.backendFailed("llama-server completion was not successful.")
                    }
                    let text = try LlamaEngineSupport.completionContent(data)
                    continuation.yield(Token(text: text, isComplete: true))
                    await self.finishGeneration(sessionId: session.id, token: token)
                    continuation.finish()
                } catch is CancellationError {
                    await self.finishGeneration(sessionId: session.id, token: token)
                    continuation.finish(throwing: LlamaEngineError.cancelled)
                } catch {
                    await self.finishGeneration(sessionId: session.id, token: token)
                    continuation.finish(throwing: error)
                }
            }
            slot.task = task
            continuation.onTermination = { @Sendable _ in
                task.cancel()
            }
        }
        tasks[session.id] = slot.task
        return stream
    }

    public func cancel(sessionId: String, requestId: String) async {
        guard let activeRequestId = requestIds[sessionId],
              activeRequestId.caseInsensitiveCompare(requestId) == .orderedSame else { return }
        generation[sessionId] = nil
        tasks[sessionId]?.cancel()
    }

    public func cancelAndWait(sessionId: String, requestId: String) async {
        guard let activeRequestId = requestIds[sessionId],
              activeRequestId.caseInsensitiveCompare(requestId) == .orderedSame,
              let task = tasks[sessionId] else { return }
        await cancel(sessionId: sessionId, requestId: requestId)
        await task.value
    }

    public func unload(sessionId: String) async {
        if let requestId = requestIds[sessionId] {
            await cancelAndWait(sessionId: sessionId, requestId: requestId)
        }
        generation[sessionId] = nil
        requestIds[sessionId] = nil
        tasks[sessionId] = nil
        loaded[sessionId] = nil
    }

    private func isCurrent(_ sessionId: String, _ token: UUID) -> Bool {
        generation[sessionId] == token
    }

    private func finishGeneration(sessionId: String, token: UUID) {
        if generation[sessionId] == token { generation[sessionId] = nil }
        if requestIds[sessionId]?.caseInsensitiveCompare(token.uuidString) == .orderedSame {
            requestIds[sessionId] = nil
            tasks[sessionId] = nil
        }
    }

    private func data(from url: URL, method: String, body: Data?) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
        }
        do {
            return try await session.data(for: request)
        } catch let error as LlamaEngineError {
            throw error
        } catch is CancellationError {
            throw LlamaEngineError.cancelled
        } catch {
            throw LlamaEngineError.backendFailed("llama-server was not reachable.")
        }
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        return URLSession(configuration: configuration, delegate: LoopbackRedirectStop(), delegateQueue: nil)
    }
}

private final class TaskSlot: @unchecked Sendable {
    var task: Task<Void, Never>?
}

private final class LoopbackRedirectStop: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        guard let host = request.url?.host, LlamaEngineSupport.isLoopbackHost(host) else { return nil }
        return request
    }
}

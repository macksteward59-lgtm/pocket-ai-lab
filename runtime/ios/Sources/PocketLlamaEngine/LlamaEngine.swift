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
    public let prompt: String
    public let maxTokens: Int
    public let temperature: Double

    public init(prompt: String, maxTokens: Int, temperature: Double) {
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
    func unload(sessionId: String) async
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

    public func cancel(sessionId: String, requestId: String) async {}

    public func unload(sessionId: String) async {}
}

/// llama.cpp with the Metal backend compiled in.
///
/// `requireMetal` is the default. When this process cannot create a Metal backend,
/// load throws `backendUnavailable` and does not read the model into a session.
/// Pass `requireMetal: false` only for an explicit CPU run. CPU text is still llama.cpp
/// output. This engine yields one completed string, not a fabricated partial.
public actor LlamaCppMetalBackend: LlamaEngine {
    private let requireMetal: Bool
    private let treatMetalAsUnavailable: Bool
    private var sessions: [String: LoadedSession] = [:]
    private var reports: [String: LlamaOffloadReport] = [:]
    private var generation: [String: UUID] = [:]

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
        let token = UUID()
        generation[session.id] = token
        let stream = AsyncThrowingStream<Token, Error> { continuation in
            let task = Task {
                do {
                    let text = try await self.generateText(sessionId: session.id, request: request)
                    guard await self.isCurrent(session.id, token) else {
                        continuation.finish(throwing: LlamaEngineError.cancelled)
                        return
                    }
                    continuation.yield(Token(text: text, isComplete: true))
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { @Sendable _ in
                task.cancel()
                Task { await self.cancel(sessionId: session.id, requestId: token.uuidString) }
            }
        }
        return stream
        #endif
    }

    public func cancel(sessionId: String, requestId: String) async {
        guard !requestId.isEmpty else { return }
        generation[sessionId] = nil
        #if POCKET_LLAMA_LINKED
        sessions[sessionId]?.requestCancel()
        #endif
    }

    public func unload(sessionId: String) async {
        generation[sessionId] = nil
        reports[sessionId] = nil
        #if POCKET_LLAMA_LINKED
        let loaded = sessions.removeValue(forKey: sessionId)
        loaded?.close()
        #endif
    }

    private func isCurrent(_ sessionId: String, _ token: UUID) -> Bool {
        generation[sessionId] == token
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
    private let handle: UnsafeMutablePointer<pocket_llama>
    private let lock = NSLock()
    private var alive = true

    private init(handle: UnsafeMutablePointer<pocket_llama>, report: LlamaOffloadReport) {
        self.handle = handle
        self.report = report
    }

    static func open(model: ModelDescriptor, gpuLayers: Int32, metalDeviceUsable: Bool) throws -> LoadedSession {
        var err = [CChar](repeating: 0, count: 768)
        var handle: UnsafeMutablePointer<pocket_llama>?
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
    private var tasks: [String: Task<Void, Never>] = [:]

    public init(baseURL: URL, session: URLSession = LoopbackLlamaEngine.makeSession()) throws {
        self.baseURL = try LlamaEngineSupport.validateLoopbackBaseURL(baseURL)
        self.session = session
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
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish(throwing: LlamaEngineError.cancelled)
                } catch {
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
        guard !requestId.isEmpty else { return }
        generation[sessionId] = nil
        tasks[sessionId]?.cancel()
        tasks[sessionId] = nil
    }

    public func unload(sessionId: String) async {
        generation[sessionId] = nil
        tasks[sessionId]?.cancel()
        tasks[sessionId] = nil
        loaded[sessionId] = nil
    }

    private func isCurrent(_ sessionId: String, _ token: UUID) -> Bool {
        generation[sessionId] == token
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

import Foundation

/// Local inference boundary for Pocket AI Lab on iOS.
///
/// Model text is untrusted. Nothing in this file grants APEX authorization.
/// `PlaceholderLlamaEngine` and `LlamaCppMetalBackend` fail closed: they do not
/// invent tokens. `LoopbackLlamaEngine` talks only to a loopback llama-server
/// and returns that server's `content` string. Metal is not implemented here.

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

/// Metal llama.cpp is not linked in this source tree. Calling it is a typed failure, not a generation.
public actor LlamaCppMetalBackend: LlamaEngine {
    public init() {}

    public func load(model: ModelDescriptor) async throws -> RuntimeSession {
        throw LlamaEngineError.backendUnavailable("llama.cpp Metal is not implemented in this build. No session was created.")
    }

    public func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        throw LlamaEngineError.backendUnavailable("llama.cpp Metal is not implemented in this build. No tokens were produced.")
    }

    public func cancel(sessionId: String, requestId: String) async {}

    public func unload(sessionId: String) async {}
}

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

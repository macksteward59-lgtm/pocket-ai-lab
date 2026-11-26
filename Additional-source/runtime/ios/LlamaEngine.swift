// Pocket AI Lab — iOS Runtime Stubs
// These implement the proposed LlamaEngine protocol.
// Full llama.cpp Metal integration is the next concrete step (Gate 1).

import Foundation

public struct ModelDescriptor: Sendable, Codable {
    public let id: String
    public let name: String
    public let path: String
    public let contextLength: Int
    public let quantization: String?
}

public struct RuntimeSession: Sendable {
    public let id: String
    public let modelId: String
}

public struct GenerationRequest: Sendable {
    public let prompt: String
    public let maxTokens: Int
    public let temperature: Double
}

public struct Token: Sendable {
    public let text: String
    public let isComplete: Bool
}

public protocol LlamaEngine: Sendable {
    func load(model: ModelDescriptor) async throws -> RuntimeSession
    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error>
    func cancel(sessionId: String, requestId: String) async
    func unload(sessionId: String) async
}

/// Placeholder implementation — replace with llama.cpp bindings
public actor PlaceholderLlamaEngine: LlamaEngine {
    public func load(model: ModelDescriptor) async throws -> RuntimeSession {
        return RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }

    public func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: "[placeholder inference]", isComplete: false))
            continuation.yield(Token(text: "", isComplete: true))
            continuation.finish()
        }
    }

    public func cancel(sessionId: String, requestId: String) async {}
    public func unload(sessionId: String) async {}
}

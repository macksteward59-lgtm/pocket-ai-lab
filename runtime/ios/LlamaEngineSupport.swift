import Foundation

/// Pure checks for the iOS engine. They do not perform inference and they do not authorize anything.
public enum LlamaEngineSupport {
    public static func isLoopbackHost(_ host: String) -> Bool {
        let name = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased()
        return name == "127.0.0.1" || name == "localhost" || name == "::1"
    }

    /// Accepts only an http loopback origin with no credentials, query, or fragment.
    public static func validateLoopbackBaseURL(_ url: URL) throws -> URL {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            throw LlamaEngineError.remoteEndpointRejected("The llama-server URL must be http or https.")
        }
        if url.user != nil || url.password != nil {
            throw LlamaEngineError.remoteEndpointRejected("The llama-server URL cannot contain credentials.")
        }
        if let query = url.query, !query.isEmpty {
            throw LlamaEngineError.remoteEndpointRejected("The llama-server URL cannot contain a query.")
        }
        if let fragment = url.fragment, !fragment.isEmpty {
            throw LlamaEngineError.remoteEndpointRejected("The llama-server URL cannot contain a fragment.")
        }
        guard let host = url.host, isLoopbackHost(host) else {
            throw LlamaEngineError.remoteEndpointRejected("The llama-server URL must stay on loopback.")
        }
        guard let port = url.port, port > 0 else {
            throw LlamaEngineError.remoteEndpointRejected("The llama-server URL must include a port.")
        }
        guard var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            throw LlamaEngineError.remoteEndpointRejected("The llama-server URL could not be read.")
        }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        parts.user = nil
        parts.password = nil
        parts.scheme = scheme
        parts.port = port
        guard let cleaned = parts.url else {
            throw LlamaEngineError.remoteEndpointRejected("The llama-server URL could not be normalized.")
        }
        return cleaned
    }

    public static func validateModel(_ model: ModelDescriptor) throws {
        if model.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw LlamaEngineError.invalidModel("Model id is required.")
        }
        if model.path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw LlamaEngineError.invalidModel("Model path is required.")
        }
        if model.contextLength < 1 {
            throw LlamaEngineError.invalidModel("Context length must be positive.")
        }
    }

    public static func validateRequest(_ request: GenerationRequest) throws {
        if request.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            throw LlamaEngineError.invalidRequest("Prompt is required.")
        }
        if request.maxTokens < 1 || request.maxTokens > 32768 {
            throw LlamaEngineError.invalidRequest("maxTokens must be from 1 through 32768.")
        }
        if !request.temperature.isFinite || request.temperature < 0 || request.temperature > 2 {
            throw LlamaEngineError.invalidRequest("temperature must be from 0 through 2.")
        }
    }

    public static func healthIsReady(_ data: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return object["status"] as? String == "ok"
    }

    /// Returns the server's content string. Empty or missing content is a failure, not a token.
    public static func completionContent(_ data: Data) throws -> String {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw LlamaEngineError.backendFailed("llama-server completion was not a JSON object.")
        }
        guard let content = object["content"] as? String else {
            throw LlamaEngineError.backendFailed("llama-server completion did not include string content.")
        }
        let text = content.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            throw LlamaEngineError.backendFailed("llama-server completion content was empty.")
        }
        return text
    }

    public static func completionBody(prompt: String, maxTokens: Int, temperature: Double) throws -> Data {
        let body: [String: Any] = [
            "prompt": prompt,
            "n_predict": maxTokens,
            "temperature": temperature,
            "stream": false
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else {
            throw LlamaEngineError.invalidRequest("The completion body could not be encoded.")
        }
        return data
    }
}

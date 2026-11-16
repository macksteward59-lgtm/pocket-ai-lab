import PocketLlamaEngine

/// Compatibility surface for the original Director bridge, backed by the
/// repository's single native inference runtime rather than a second engine.
public typealias LlamaEngine = PocketLlamaEngine.LlamaEngine

public struct LocalModel: Sendable, Equatable, Identifiable {
    public let descriptor: ModelDescriptor
    public let estimatedMemoryMB: Int

    public var id: String { descriptor.id }

    public init(descriptor: ModelDescriptor, estimatedMemoryMB: Int) throws {
        guard estimatedMemoryMB > 0 else { throw LocalModelError.invalidMemoryEstimate }
        try LlamaEngineSupport.validateModel(descriptor)
        self.descriptor = descriptor
        self.estimatedMemoryMB = estimatedMemoryMB
    }
}

public enum LocalModelError: Error, Equatable, Sendable {
    case invalidMemoryEstimate
}

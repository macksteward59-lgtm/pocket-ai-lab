import Foundation
import LlamaCppBridge

/// Metadata reported by the pinned GGUF parser. These are declarations in the
/// artifact, not proof of model competence, authenticity, or runtime readiness.
public struct GGUFModelMetadata: Equatable, Sendable {
    public let version: Int
    public let architecture: String
    public let modelName: String?
    public let tokenizerModel: String?
    public let trainingContextLength: Int?
    public let fileType: Int?
    public let parameterCount: Int?
    public let fileSizeBytes: UInt64
    public let metadataKeyCount: Int
}

/// Uses the exact GGUF parser shipped with the pinned llama.cpp build. It reads
/// metadata without allocating model tensor weights and fails closed when the
/// linked parser is unavailable or rejects the artifact.
public enum GGUFMetadataInspector {
    public static func inspect(at url: URL) throws -> GGUFModelMetadata {
        #if POCKET_LLAMA_LINKED
        var metadata = pocket_llama_metadata()
        var errorBuffer = [CChar](repeating: 0, count: 512)
        let status = url.path.withCString { path in
            errorBuffer.withUnsafeMutableBufferPointer { buffer in
                pocket_llama_inspect_gguf(path, &metadata, buffer.baseAddress, buffer.count)
            }
        }
        guard status == POCKET_LLAMA_OK else {
            let message = errorBuffer.withUnsafeBufferPointer { buffer in
                guard let baseAddress = buffer.baseAddress, baseAddress.pointee != 0 else {
                    return "The pinned GGUF metadata parser rejected the model."
                }
                return String(cString: baseAddress)
            }
            throw LlamaEngineError.invalidModel(message)
        }

        return GGUFModelMetadata(
            version: Int(metadata.gguf_version),
            architecture: decode(&metadata.architecture, capacity: Int(POCKET_LLAMA_METADATA_ARCH_MAX)),
            modelName: optionalString(decode(&metadata.model_name, capacity: Int(POCKET_LLAMA_METADATA_NAME_MAX))),
            tokenizerModel: optionalString(decode(&metadata.tokenizer_model, capacity: Int(POCKET_LLAMA_METADATA_TOKENIZER_MAX))),
            trainingContextLength: metadata.has_training_context == 1 ? Int(metadata.training_context_length) : nil,
            fileType: metadata.has_file_type == 1 ? Int(metadata.file_type) : nil,
            parameterCount: metadata.has_parameter_count == 1 ? Int(exactly: metadata.parameter_count) : nil,
            fileSizeBytes: metadata.file_size_bytes,
            metadataKeyCount: Int(metadata.metadata_key_count)
        )
        #else
        throw LlamaEngineError.backendUnavailable("The pinned llama.cpp GGUF metadata parser is not linked in this build.")
        #endif
    }

    private static func optionalString(_ value: String) -> String? {
        value.isEmpty ? nil : value
    }

    private static func decode<Buffer>(_ buffer: inout Buffer, capacity: Int) -> String {
        withUnsafePointer(to: &buffer) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: capacity) {
                String(cString: $0)
            }
        }
    }
}

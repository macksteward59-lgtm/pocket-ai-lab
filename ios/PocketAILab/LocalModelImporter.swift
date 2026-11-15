import Foundation

enum LocalModelImporterError: LocalizedError {
    case notGGUF
    case invalidGGUFHeader

    var errorDescription: String? {
        switch self {
        case .notGGUF:
            return "Choose a GGUF model file."
        case .invalidGGUFHeader:
            return "The selected file does not contain a GGUF header. The existing model was left unchanged."
        }
    }
}

/// Copies user-selected GGUF files without blocking the UI and preserves the
/// last known-good destination until header validation and SHA-256 complete.
enum LocalModelImporter {
    static func importGGUF(from source: URL, into directory: URL) async throws -> ImportedModelArtifact {
        guard source.pathExtension.lowercased() == "gguf" else {
            throw LocalModelImporterError.notGGUF
        }

        let hasSecurityScope = source.startAccessingSecurityScopedResource()
        defer {
            if hasSecurityScope {
                source.stopAccessingSecurityScopedResource()
            }
        }

        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )

        let destination = directory.appendingPathComponent(source.lastPathComponent)
        let sourcePath = source.standardizedFileURL.resolvingSymlinksInPath().path
        let destinationPath = destination.standardizedFileURL.resolvingSymlinksInPath().path

        // Files may hand the app a URL to a model already in Documents/Models.
        // Never remove or copy a file onto itself. Hash it off the main actor.
        if sourcePath == destinationPath {
            let fingerprint = try await Task.detached(priority: .utility) {
                try validateGGUF(at: destination)
                return try ModelArtifactFingerprint.compute(at: destination)
            }.value
            return ImportedModelArtifact(url: destination, fingerprint: fingerprint)
        }

        let staged = directory.appendingPathComponent(".\(UUID().uuidString).gguf-importing")
        do {
            let fingerprint = try await Task.detached(priority: .utility) {
                try FileManager.default.copyItem(at: source, to: staged)
                try validateGGUF(at: staged)
                let fingerprint = try ModelArtifactFingerprint.compute(at: staged)

                if FileManager.default.fileExists(atPath: destination.path) {
                    // The staged file is in the same directory, so replacement
                    // is atomic on the destination volume. A failed copy,
                    // header check, or hash read preserves the previous model.
                    _ = try FileManager.default.replaceItemAt(
                        destination,
                        withItemAt: staged,
                        backupItemName: nil,
                        options: []
                    )
                } else {
                    try FileManager.default.moveItem(at: staged, to: destination)
                }
                return fingerprint
            }.value
            return ImportedModelArtifact(url: destination, fingerprint: fingerprint)
        } catch {
            try? FileManager.default.removeItem(at: staged)
            throw error
        }
    }

    private static func validateGGUF(at url: URL) throws {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let magic = try handle.read(upToCount: 4)
        guard magic == Data("GGUF".utf8) else {
            throw LocalModelImporterError.invalidGGUFHeader
        }
    }
}

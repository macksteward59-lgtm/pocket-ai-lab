import Foundation

struct LocalModelCatalogEntry: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let name: String
    let fileName: String
    let sha256: String
    let byteCount: UInt64
    let contextLength: Int
    let quantization: String
    let capabilities: [String]
    let estimatedMemoryMB: Int
    let importedAt: Date
}

struct LocalModelCatalogSnapshot: Equatable, Sendable {
    let entries: [LocalModelCatalogEntry]
    let selectedModelID: String?
}

/// Device-local inventory and selection metadata. Catalog membership is not
/// proof that a model is loaded, ready, authentic, or authorized for actions.
struct LocalModelCatalogStore {
    enum StoreError: Error, Equatable {
        case unsupportedVersion
        case invalidEntry
        case duplicateModel
        case modelNotFound
        case unsafeModelPath
        case modelFileMissing
        case archiveTooLarge
    }

    private struct Archive: Codable {
        let version: Int
        let savedAt: Date
        let selectedModelID: String?
        let entries: [LocalModelCatalogEntry]
    }

    static let currentVersion = 1
    static let maximumEntries = 100
    static let maximumArchiveBytes = 256 * 1_024
    static let defaultContextLength = 2_048

    private let fileURL: URL
    private let modelDirectory: URL
    private let fileManager: FileManager
    private let now: () -> Date

    init(
        fileURL: URL? = nil,
        modelDirectory: URL,
        fileManager: FileManager = .default,
        now: @escaping () -> Date = Date.init
    ) {
        self.modelDirectory = modelDirectory.standardizedFileURL
        self.fileURL = fileURL ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PocketAILab", isDirectory: true)
            .appendingPathComponent("ModelCatalog.json")
        self.fileManager = fileManager
        self.now = now
    }

    func load() throws -> LocalModelCatalogSnapshot {
        guard fileManager.fileExists(atPath: fileURL.path) else {
            return LocalModelCatalogSnapshot(entries: [], selectedModelID: nil)
        }
        let attributes = try fileManager.attributesOfItem(atPath: fileURL.path)
        guard let size = attributes[.size] as? NSNumber,
              size.int64Value >= 0,
              size.int64Value <= Int64(Self.maximumArchiveBytes) else {
            throw StoreError.archiveTooLarge
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let archive = try decoder.decode(Archive.self, from: Data(contentsOf: fileURL))
        guard archive.version == Self.currentVersion else { throw StoreError.unsupportedVersion }
        guard archive.entries.count <= Self.maximumEntries else { throw StoreError.invalidEntry }

        var seen = Set<String>()
        for entry in archive.entries {
            guard Self.isValid(entry), seen.insert(entry.id).inserted else {
                throw StoreError.invalidEntry
            }
        }
        let selected = archive.selectedModelID.flatMap { id in
            archive.entries.contains(where: { $0.id == id }) ? id : nil
        }
        return LocalModelCatalogSnapshot(entries: archive.entries, selectedModelID: selected)
    }

    @discardableResult
    func register(_ artifact: ImportedModelArtifact, displayName: String) throws -> LocalModelCatalogSnapshot {
        let fileName = artifact.url.lastPathComponent
        let resolved = try resolveFile(named: fileName)
        guard resolved == artifact.url.standardizedFileURL else {
            throw StoreError.unsafeModelPath
        }
        let normalizedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedName.isEmpty,
              normalizedName.count <= 120,
              artifact.fingerprint.sha256.count == 64,
              Self.isHexDigest(artifact.fingerprint.sha256),
              artifact.fingerprint.byteCount > 0 else {
            throw StoreError.invalidEntry
        }
        let attributes = try fileManager.attributesOfItem(atPath: resolved.path)
        guard let size = attributes[.size] as? NSNumber,
              size.uint64Value == artifact.fingerprint.byteCount else {
            throw StoreError.invalidEntry
        }

        var snapshot = try load()
        let id = "sha256-\(artifact.fingerprint.sha256.lowercased())"
        let existing = snapshot.entries.first(where: { $0.id == id })
        if existing == nil && snapshot.entries.count >= Self.maximumEntries {
            throw StoreError.invalidEntry
        }
        let entry = LocalModelCatalogEntry(
            id: id,
            name: normalizedName,
            fileName: fileName,
            sha256: artifact.fingerprint.sha256.lowercased(),
            byteCount: artifact.fingerprint.byteCount,
            contextLength: Self.defaultContextLength,
            quantization: "GGUF · metadata not yet parsed",
            capabilities: ["text-generation"],
            estimatedMemoryMB: Self.estimateMemoryMB(byteCount: artifact.fingerprint.byteCount),
            importedAt: existing?.importedAt ?? now()
        )
        var entries = snapshot.entries.filter { $0.id != id }
        entries.insert(entry, at: 0)
        snapshot = LocalModelCatalogSnapshot(entries: entries, selectedModelID: id)
        try write(snapshot)
        return snapshot
    }

    @discardableResult
    func select(_ modelID: String?) throws -> LocalModelCatalogSnapshot {
        let snapshot = try load()
        if let modelID {
            guard let entry = snapshot.entries.first(where: { $0.id == modelID }) else {
                throw StoreError.modelNotFound
            }
            _ = try resolve(entry)
        }
        let updated = LocalModelCatalogSnapshot(entries: snapshot.entries, selectedModelID: modelID)
        try write(updated)
        return updated
    }

    func resolve(_ entry: LocalModelCatalogEntry) throws -> URL {
        guard Self.isValid(entry) else { throw StoreError.invalidEntry }
        let url = try resolveFile(named: entry.fileName)
        guard fileManager.fileExists(atPath: url.path) else { throw StoreError.modelFileMissing }
        let attributes = try fileManager.attributesOfItem(atPath: url.path)
        guard let size = attributes[.size] as? NSNumber,
              size.uint64Value == entry.byteCount else {
            throw StoreError.modelFileMissing
        }
        return url
    }

    private func resolveFile(named fileName: String) throws -> URL {
        guard !fileName.isEmpty,
              fileName == URL(fileURLWithPath: fileName).lastPathComponent,
              !fileName.contains("/"),
              !fileName.contains("\\"),
              fileName.lowercased().hasSuffix(".gguf") else {
            throw StoreError.unsafeModelPath
        }
        let candidate = modelDirectory.appendingPathComponent(fileName).standardizedFileURL
        let root = modelDirectory.resolvingSymlinksInPath().standardizedFileURL
        let resolved = candidate.resolvingSymlinksInPath().standardizedFileURL
        guard resolved.deletingLastPathComponent() == root else {
            throw StoreError.unsafeModelPath
        }
        return resolved
    }

    private func write(_ snapshot: LocalModelCatalogSnapshot) throws {
        guard snapshot.entries.count <= Self.maximumEntries else { throw StoreError.invalidEntry }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(Archive(
            version: Self.currentVersion,
            savedAt: now(),
            selectedModelID: snapshot.selectedModelID,
            entries: snapshot.entries
        ))
        guard data.count <= Self.maximumArchiveBytes else { throw StoreError.archiveTooLarge }
        let directory = fileURL.deletingLastPathComponent()
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        #if os(iOS)
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: directory.path
        )
        var directoryValues = URLResourceValues()
        directoryValues.isExcludedFromBackup = true
        var protectedDirectory = directory
        try protectedDirectory.setResourceValues(directoryValues)
        #endif
        try data.write(to: fileURL, options: .atomic)
        #if os(iOS)
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: fileURL.path
        )
        var fileValues = URLResourceValues()
        fileValues.isExcludedFromBackup = true
        var protectedFile = fileURL
        try protectedFile.setResourceValues(fileValues)
        #endif
    }

    private static func isValid(_ entry: LocalModelCatalogEntry) -> Bool {
        !entry.id.isEmpty &&
        entry.id == "sha256-\(entry.sha256.lowercased())" &&
        entry.sha256.count == 64 &&
        isHexDigest(entry.sha256) &&
        !entry.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        entry.name.utf8.count <= 480 &&
        entry.fileName == URL(fileURLWithPath: entry.fileName).lastPathComponent &&
        entry.fileName.lowercased().hasSuffix(".gguf") &&
        entry.byteCount > 0 &&
        entry.contextLength > 0 &&
        entry.estimatedMemoryMB > 0 &&
        !entry.capabilities.isEmpty &&
        entry.capabilities.count <= 16
    }

    private static func isHexDigest(_ value: String) -> Bool {
        value.utf8.allSatisfy {
            (48...57).contains($0) || (97...102).contains($0) || (65...70).contains($0)
        }
    }

    private static func estimateMemoryMB(byteCount: UInt64) -> Int {
        let megabytes = Double(byteCount) / (1_024 * 1_024) * 1.2
        return max(1, min(Int.max / 2, Int(ceil(megabytes))))
    }
}

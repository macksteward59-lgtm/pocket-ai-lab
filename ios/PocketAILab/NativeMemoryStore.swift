import Foundation
import CryptoKit
import Security

public enum NativeMemoryLayer: String, Codable, CaseIterable, Identifiable, Sendable {
    case working, episodic, semantic, procedural
    public var id: String { rawValue }
    public var title: String { rawValue.capitalized }
}

public struct NativeMemoryProvenance: Codable, Equatable, Sendable {
    public let agentId: String
    public let taskId: String?
    public var verified: Bool
    public var sourceRefs: [String]

    public init(agentId: String, taskId: String? = nil, verified: Bool = false, sourceRefs: [String] = []) {
        self.agentId = agentId
        self.taskId = taskId
        self.verified = verified
        self.sourceRefs = sourceRefs
    }
}

public struct NativeMemoryEntry: Codable, Equatable, Identifiable, Sendable {
    public let id: String
    public let layer: NativeMemoryLayer
    public var content: String
    public var provenance: NativeMemoryProvenance
    public let createdAt: Date

    public init(id: String = UUID().uuidString, layer: NativeMemoryLayer, content: String,
                provenance: NativeMemoryProvenance, createdAt: Date = Date()) {
        self.id = id
        self.layer = layer
        self.content = content
        self.provenance = provenance
        self.createdAt = createdAt
    }
}

public enum NativeMemoryVaultError: Error, Equatable, Sendable {
    case keyUnavailable
    case integrityFailure
    case invalidEntry
    case storageUnavailable
}

public protocol NativeMemoryKeyProvider: Sendable {
    /// Returns nil only when no key exists. It must never create or rotate a key.
    func existingKey() throws -> SymmetricKey?
    /// Creates a key only for a new vault, or returns the existing stable key.
    func getOrCreateKey() throws -> SymmetricKey
}

/// Stores encrypted, user-controlled memory in the app's private Application Support directory.
/// It has no chat observer, model callback, verification API, or plaintext fallback.
public actor NativeMemoryStore {
    private static let magic = Data("PALMEM01".utf8)
    private static let aad = Data("pocket-ai-lab:native-memory:v1".utf8)
    private static let maximumVaultBytes = 8 * 1_024 * 1_024
    private static let maximumEntries = 10_000
    private static let maximumContentBytes = 32_000
    private let fileURL: URL
    private let keyProvider: any NativeMemoryKeyProvider

    public init(fileURL: URL, keyProvider: any NativeMemoryKeyProvider = KeychainNativeMemoryKeyProvider()) {
        self.fileURL = fileURL
        self.keyProvider = keyProvider
    }

    public static func applicationDefault() -> NativeMemoryStore {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let file = root.appendingPathComponent("PocketAILab", isDirectory: true)
            .appendingPathComponent("Memory", isDirectory: true)
            .appendingPathComponent("memory.enc", isDirectory: false)
        return NativeMemoryStore(fileURL: file)
    }

    public func load() throws -> [NativeMemoryEntry] {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return [] }
        let bytes: Data
        do { bytes = try Data(contentsOf: fileURL, options: .mappedIfSafe) }
        catch { throw NativeMemoryVaultError.storageUnavailable }
        guard bytes.count >= Self.magic.count + 28,
              bytes.count <= Self.maximumVaultBytes,
              bytes.prefix(Self.magic.count) == Self.magic else {
            throw NativeMemoryVaultError.integrityFailure
        }
        guard let key = try keyProvider.existingKey() else {
            throw NativeMemoryVaultError.keyUnavailable
        }
        let combined = Data(bytes.dropFirst(Self.magic.count))
        let box: AES.GCM.SealedBox
        do { box = try AES.GCM.SealedBox(combined: combined) }
        catch { throw NativeMemoryVaultError.integrityFailure }
        var plaintext: Data
        do { plaintext = try AES.GCM.open(box, using: key, authenticating: Self.aad) }
        catch { throw NativeMemoryVaultError.integrityFailure }
        defer { plaintext.resetBytes(in: 0..<plaintext.count) }
        let entries: [NativeMemoryEntry]
        do { entries = try JSONDecoder().decode([NativeMemoryEntry].self, from: plaintext) }
        catch { throw NativeMemoryVaultError.integrityFailure }
        guard entries.count <= Self.maximumEntries, entries.allSatisfy(Self.isValid) else {
            throw NativeMemoryVaultError.integrityFailure
        }
        return entries
    }

    @discardableResult
    public func insert(layer: NativeMemoryLayer, content: String, agentId: String = "user",
                       taskId: String? = nil, sourceRefs: [String] = []) throws -> String {
        let normalized = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, normalized.utf8.count <= Self.maximumContentBytes,
              !agentId.isEmpty, agentId.utf8.count <= 128,
              sourceRefs.count <= 32, sourceRefs.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 }),
              taskId == nil || taskId!.utf8.count <= 512 else {
            throw NativeMemoryVaultError.invalidEntry
        }
        var entries = try load()
        guard entries.count < Self.maximumEntries else { throw NativeMemoryVaultError.invalidEntry }
        let entry = NativeMemoryEntry(
            layer: layer,
            content: normalized,
            provenance: NativeMemoryProvenance(agentId: agentId, taskId: taskId, verified: false, sourceRefs: sourceRefs)
        )
        entries.append(entry)
        try persist(entries)
        return entry.id
    }

    @discardableResult
    public func update(id: String, content: String, sourceRefs: [String]? = nil) throws -> Bool {
        let normalized = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, normalized.utf8.count <= Self.maximumContentBytes,
              sourceRefs == nil || (sourceRefs!.count <= 32 && sourceRefs!.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 })) else {
            throw NativeMemoryVaultError.invalidEntry
        }
        var entries = try load()
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return false }
        entries[index].content = normalized
        if let sourceRefs { entries[index].provenance.sourceRefs = sourceRefs }
        entries[index].provenance.verified = false
        try persist(entries)
        return true
    }

    @discardableResult
    public func delete(id: String) throws -> Bool {
        var entries = try load()
        guard let index = entries.firstIndex(where: { $0.id == id }) else { return false }
        entries.remove(at: index)
        try persist(entries)
        return true
    }

    private func persist(_ entries: [NativeMemoryEntry]) throws {
        guard entries.count <= Self.maximumEntries, entries.allSatisfy(Self.isValid) else {
            throw NativeMemoryVaultError.invalidEntry
        }
        do {
            var plaintext = try JSONEncoder().encode(entries)
            defer { plaintext.resetBytes(in: 0..<plaintext.count) }
            let key = try keyProvider.getOrCreateKey()
            let sealed = try AES.GCM.seal(plaintext, using: key, authenticating: Self.aad)
            guard let combined = sealed.combined else { throw NativeMemoryVaultError.storageUnavailable }
            var output = Self.magic
            output.append(combined)
            guard output.count <= Self.maximumVaultBytes else { throw NativeMemoryVaultError.invalidEntry }
            let directory = fileURL.deletingLastPathComponent()
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.complete]
            )
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: directory.path)
            try output.write(to: fileURL, options: [.atomic, .completeFileProtection])
        } catch let error as NativeMemoryVaultError {
            throw error
        } catch {
            throw NativeMemoryVaultError.storageUnavailable
        }
    }

    private static func isValid(_ entry: NativeMemoryEntry) -> Bool {
        !entry.id.isEmpty && entry.id.utf8.count <= 128 &&
        !entry.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        entry.content.utf8.count <= maximumContentBytes &&
        !entry.provenance.agentId.isEmpty && entry.provenance.agentId.utf8.count <= 128 &&
        (entry.provenance.taskId == nil || entry.provenance.taskId!.utf8.count <= 512) &&
        entry.provenance.sourceRefs.count <= 32 &&
        entry.provenance.sourceRefs.allSatisfy { !$0.isEmpty && $0.utf8.count <= 512 }
    }
}

/// Keychain-backed key custody. A missing key is only created on a write to a new vault.
/// The key is device-only and available only while the device is unlocked.
public struct KeychainNativeMemoryKeyProvider: NativeMemoryKeyProvider {
    private let service = "com.pocketailab.native-memory"
    private let account = "vault-key-v1"

    public init() {}

    public func existingKey() throws -> SymmetricKey? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data, data.count == 32 else {
            throw NativeMemoryVaultError.keyUnavailable
        }
        var keyBytes = data
        defer { keyBytes.resetBytes(in: 0..<keyBytes.count) }
        return SymmetricKey(data: keyBytes)
    }

    public func getOrCreateKey() throws -> SymmetricKey {
        if let existing = try existingKey() { return existing }
        var bytes = Data(count: 32)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, 32, buffer.baseAddress!)
        }
        guard status == errSecSuccess else { throw NativeMemoryVaultError.keyUnavailable }
        var query = baseQuery()
        query[kSecValueData as String] = bytes
        query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let addStatus = SecItemAdd(query as CFDictionary, nil)
        if addStatus == errSecDuplicateItem {
            guard let raced = try existingKey() else { throw NativeMemoryVaultError.keyUnavailable }
            return raced
        }
        guard addStatus == errSecSuccess else { throw NativeMemoryVaultError.keyUnavailable }
        defer { bytes.resetBytes(in: 0..<bytes.count) }
        return SymmetricKey(data: bytes)
    }

    private func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

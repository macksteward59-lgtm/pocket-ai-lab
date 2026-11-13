import Foundation
import Security

public enum RuntimeProofReplayStoreError: Error, Sendable {
    case keychainStatus(OSStatus)
    case corruptRecord
}

/// The store must have one process-wide writer. The Keychain item update is durable,
/// but the read/compare/write sequence is not a cross-process compare-and-swap.
public protocol RuntimeProofReplayStore: Sendable {
    func accept(sessionId: String, keyId: String, generationCounter: Int) async throws -> Bool
}

/// Device-only Keychain persistence for accepted proof generations.
/// Inject one shared instance into the app's verifier composition root.
public actor KeychainRuntimeProofReplayStore: RuntimeProofReplayStore {
    private let service: String

    public init(service: String = "com.pocketailab.runtime-proof-replay.v1") {
        self.service = service
    }

    public func accept(sessionId: String, keyId: String, generationCounter: Int) async throws -> Bool {
        guard !sessionId.isEmpty, !keyId.isEmpty, generationCounter > 0 else {
            return false
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: sessionId,
            kSecAttrSynchronizable as String: false
        ]

        var existing: CFTypeRef?
        let status = SecItemCopyMatching(query.merging([
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]) { _, new in new }, &existing)

        if status == errSecItemNotFound {
            let record = ReplayRecord(keyId: keyId, generationCounter: generationCounter)
            var insertion = query
            insertion[kSecValueData as String] = try JSONEncoder().encode(record)
            insertion[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            let addStatus = SecItemAdd(insertion as CFDictionary, nil)
            if addStatus == errSecSuccess { return true }
            if addStatus == errSecDuplicateItem { return false }
            throw RuntimeProofReplayStoreError.keychainStatus(addStatus)
        }

        guard status == errSecSuccess,
              let data = existing as? Data,
              let previous = try? JSONDecoder().decode(ReplayRecord.self, from: data) else {
            if status != errSecSuccess {
                throw RuntimeProofReplayStoreError.keychainStatus(status)
            }
            throw RuntimeProofReplayStoreError.corruptRecord
        }

        guard previous.keyId == keyId,
              generationCounter > previous.generationCounter else {
            return false
        }

        let replacement = try JSONEncoder().encode(
            ReplayRecord(keyId: keyId, generationCounter: generationCounter)
        )
        let updateStatus = SecItemUpdate(
            query as CFDictionary,
            [kSecValueData as String: replacement] as CFDictionary
        )
        guard updateStatus == errSecSuccess else {
            throw RuntimeProofReplayStoreError.keychainStatus(updateStatus)
        }
        return true
    }
}

private struct ReplayRecord: Codable {
    let keyId: String
    let generationCounter: Int
}

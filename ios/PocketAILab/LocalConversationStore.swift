import Foundation

/// Device-local, versioned conversation archive. This stores UI history only;
/// it is not trusted memory, evidence, or an authorization source.
struct LocalConversationStore {
    enum StoreError: Error, Equatable {
        case unsupportedVersion
    }

    private struct Archive: Codable {
        let version: Int
        let savedAt: Date
        let messages: [ChatLine]
    }

    static let currentVersion = 1
    static let maximumMessages = 200
    static let maximumArchiveBytes = 256 * 1_024
    static let maximumMessageBytes = 32 * 1_024
    static let retentionInterval: TimeInterval = 30 * 24 * 60 * 60

    private let fileURL: URL
    private let fileManager: FileManager
    private let now: () -> Date

    init(
        fileURL: URL? = nil,
        fileManager: FileManager = .default,
        now: @escaping () -> Date = Date.init
    ) {
        self.fileURL = fileURL ?? fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PocketAILab", isDirectory: true)
            .appendingPathComponent("ConversationHistory.json")
        self.fileManager = fileManager
        self.now = now
    }

    func load() throws -> [ChatLine] {
        guard fileManager.fileExists(atPath: fileURL.path) else { return [] }
        let data = try Data(contentsOf: fileURL)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let archive = try decoder.decode(Archive.self, from: data)
        guard archive.version == Self.currentVersion else { throw StoreError.unsupportedVersion }
        let cutoff = now().addingTimeInterval(-Self.retentionInterval)
        let retained = archive.messages.filter { $0.timestamp >= cutoff }
        return Self.bounded(retained, now: now())
    }

    func save(_ messages: [ChatLine]) throws {
        let boundedMessages = Self.bounded(messages, now: now())
        let archive = Archive(version: Self.currentVersion, savedAt: now(), messages: boundedMessages)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(archive)
        guard data.count <= Self.maximumArchiveBytes else {
            throw CocoaError(.fileWriteOutOfSpace)
        }
        try fileManager.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try data.write(to: fileURL, options: .atomic)
        #if os(iOS)
        try fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: fileURL.path
        )
        #endif
    }

    func clear() throws {
        guard fileManager.fileExists(atPath: fileURL.path) else { return }
        try fileManager.removeItem(at: fileURL)
    }

    private static func bounded(_ messages: [ChatLine], now: Date) -> [ChatLine] {
        let cutoff = now.addingTimeInterval(-retentionInterval)
        var result = messages
            .filter { $0.timestamp >= cutoff }
            .suffix(maximumMessages)
            .map { line in
                ChatLine(
                    id: line.id,
                    role: line.role,
                    text: clipped(line.text, limit: maximumMessageBytes),
                    timestamp: line.timestamp
                )
            }
        while result.reduce(0, { $0 + $1.role.utf8.count + $1.text.utf8.count }) > maximumArchiveBytes,
              !result.isEmpty {
            result.removeFirst()
        }
        return Array(result)
    }

    private static func clipped(_ value: String, limit: Int) -> String {
        guard value.utf8.count > limit else { return value }
        let marker = "…[older text clipped]"
        let budget = max(0, limit - marker.utf8.count)
        var prefix = ""
        var used = 0
        for scalar in value.unicodeScalars {
            let bytes = scalar.utf8.count
            guard used + bytes <= budget else { break }
            prefix.unicodeScalars.append(scalar)
            used += bytes
        }
        return prefix + marker
    }
}

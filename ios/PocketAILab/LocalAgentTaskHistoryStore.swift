import Foundation

enum AgentTaskHistoryStatus: String, Codable, Equatable {
    case running
    case completed
    case failed
    case interrupted
}

struct AgentTaskHistoryEntry: Codable, Equatable, Identifiable {
    let id: String
    let objective: String
    let createdAt: Date
    var updatedAt: Date
    var status: AgentTaskHistoryStatus
    var roleResults: [AgentTaskRoleResult]
    var finalResponse: String?
    var failureSummary: String?
}

struct AgentTaskRoleResult: Codable, Equatable, Identifiable {
    let id: String
    let role: String
    let sequence: Int
    let text: String
    let createdAt: Date
}

/// A bounded local audit trail for Agent Team UI tasks. It is not an execution
/// queue, trusted evidence store, memory system, or authorization source.
struct LocalAgentTaskHistoryStore {
    enum StoreError: Error, Equatable {
        case unsupportedVersion
        case duplicateTask
        case taskNotFound
        case invalidTransition
    }

    private struct Archive: Codable {
        let version: Int
        let savedAt: Date
        let tasks: [AgentTaskHistoryEntry]
    }

    static let currentVersion = 1
    static let retentionInterval: TimeInterval = 30 * 24 * 60 * 60
    static let maximumTasks = 50
    static let maximumArchiveBytes = 512 * 1_024
    static let maximumObjectiveBytes = 4_000
    static let maximumRoleResults = 8
    static let maximumRoleTextBytes = 8_000
    static let maximumFailureSummaryBytes = 1_000

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
            .appendingPathComponent("AgentTaskHistory.json")
        self.fileManager = fileManager
        self.now = now
    }

    func load() throws -> [AgentTaskHistoryEntry] {
        let cutoff = now().addingTimeInterval(-Self.retentionInterval)
        var changed = false
        let recovered = try readTasks()
            .filter { $0.updatedAt >= cutoff }
            .map { task in
                var value = task
                if value.status == .running {
                    value.status = .interrupted
                    value.updatedAt = now()
                    value.failureSummary = "App ended before this task recorded a terminal result. It was not resumed."
                    changed = true
                }
                return value
            }
            .sorted { $0.updatedAt > $1.updatedAt }
        if changed { try write(recovered) }
        return recovered
    }

    private func readTasks() throws -> [AgentTaskHistoryEntry] {
        guard fileManager.fileExists(atPath: fileURL.path) else { return [] }
        let attributes = try fileManager.attributesOfItem(atPath: fileURL.path)
        guard let size = attributes[.size] as? NSNumber,
              size.int64Value >= 0,
              size.int64Value <= Int64(Self.maximumArchiveBytes) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let archive = try decoder.decode(Archive.self, from: Data(contentsOf: fileURL))
        guard archive.version == Self.currentVersion else { throw StoreError.unsupportedVersion }
        return archive.tasks
    }

    func begin(id: String, objective: String) throws {
        let normalized = objective.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, id.utf8.count <= 128,
              !normalized.isEmpty, normalized.utf8.count <= Self.maximumObjectiveBytes else {
            throw StoreError.invalidTransition
        }
        var tasks = try readTasks()
        guard !tasks.contains(where: { $0.id == id }) else { throw StoreError.duplicateTask }
        let timestamp = now()
        tasks.insert(
            AgentTaskHistoryEntry(
                id: id,
                objective: Self.clipped(normalized, limit: Self.maximumObjectiveBytes),
                createdAt: timestamp,
                updatedAt: timestamp,
                status: .running,
                roleResults: [],
                finalResponse: nil,
                failureSummary: nil
            ),
            at: 0
        )
        try write(tasks)
    }

    func complete(id: String, roleResults: [AgentTaskRoleResult], finalResponse: String) throws {
        try transition(id: id, status: .completed, roleResults: roleResults,
                       finalResponse: finalResponse, failureSummary: nil)
    }

    func fail(id: String, summary: String, interrupted: Bool = false) throws {
        try transition(id: id, status: interrupted ? .interrupted : .failed,
                       roleResults: nil, finalResponse: nil,
                       failureSummary: Self.clipped(summary, limit: Self.maximumFailureSummaryBytes))
    }

    func clear() throws {
        guard fileManager.fileExists(atPath: fileURL.path) else { return }
        try fileManager.removeItem(at: fileURL)
    }

    private func transition(
        id: String,
        status: AgentTaskHistoryStatus,
        roleResults: [AgentTaskRoleResult]?,
        finalResponse: String?,
        failureSummary: String?
    ) throws {
        var tasks = try readTasks()
        guard let index = tasks.firstIndex(where: { $0.id == id }) else {
            throw StoreError.taskNotFound
        }
        guard tasks[index].status == .running else { throw StoreError.invalidTransition }
        tasks[index].status = status
        tasks[index].updatedAt = now()
        if let roleResults {
            tasks[index].roleResults = Array(roleResults.prefix(Self.maximumRoleResults)).map { result in
                AgentTaskRoleResult(
                    id: result.id,
                    role: Self.clipped(result.role, limit: 128),
                    sequence: max(0, result.sequence),
                    text: Self.clipped(result.text, limit: Self.maximumRoleTextBytes),
                    createdAt: result.createdAt
                )
            }
        }
        if let finalResponse {
            tasks[index].finalResponse = Self.clipped(finalResponse, limit: Self.maximumRoleTextBytes)
        }
        tasks[index].failureSummary = failureSummary
        try write(tasks)
    }

    private func write(_ input: [AgentTaskHistoryEntry]) throws {
        let cutoff = now().addingTimeInterval(-Self.retentionInterval)
        var tasks = Array(input.filter { $0.updatedAt >= cutoff }.prefix(Self.maximumTasks))
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        func encode(_ values: [AgentTaskHistoryEntry]) throws -> Data {
            try encoder.encode(Archive(version: Self.currentVersion, savedAt: now(), tasks: values))
        }
        var data = try encode(tasks)
        while data.count > Self.maximumArchiveBytes, !tasks.isEmpty {
            tasks.removeLast()
            data = try encode(tasks)
        }
        guard data.count <= Self.maximumArchiveBytes else {
            throw CocoaError(.fileWriteOutOfSpace)
        }
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

    private static func clipped(_ value: String, limit: Int) -> String {
        guard value.utf8.count > limit else { return value }
        let marker = "…[truncated]"
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

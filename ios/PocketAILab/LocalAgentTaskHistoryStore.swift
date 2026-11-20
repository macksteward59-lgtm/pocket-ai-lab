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
    /// Optional so existing v1 archives remain readable without migration.
    /// These supplemental results do not change the local team's outcome.
    var cloudAnalysisAttempts: [CloudAnalysisAttempt]? = nil
}

enum CloudAnalysisAttemptStatus: String, Codable, Equatable {
    case submitting, completed, rejected, unknown
}

struct CloudAnalysisAttempt: Codable, Equatable, Identifiable {
    var id: String { request.attemptID }
    let request: CloudAnalysisRequest
    let gatewayOrigin: String
    let createdAt: Date
    var updatedAt: Date
    var status: CloudAnalysisAttemptStatus
    var result: CloudAnalysisResult?
    var failureCode: String?
}

struct AgentTaskRoleResult: Codable, Equatable, Identifiable {
    let id: String
    let role: String
    let sequence: Int
    let text: String
    let createdAt: Date
    /// Optional protocol linkage fields; absent in legacy v1 archives.
    let conversationID: String?
    let recipientAgentID: String?
    let messageType: String?
    let parentMessageID: String?

    init(
        id: String,
        role: String,
        sequence: Int,
        text: String,
        createdAt: Date,
        conversationID: String? = nil,
        recipientAgentID: String? = nil,
        messageType: String? = nil,
        parentMessageID: String? = nil
    ) {
        self.id = id
        self.role = role
        self.sequence = sequence
        self.text = text
        self.createdAt = createdAt
        self.conversationID = conversationID
        self.recipientAgentID = recipientAgentID
        self.messageType = messageType
        self.parentMessageID = parentMessageID
    }

    private enum CodingKeys: String, CodingKey {
        case id, role, sequence, text, createdAt
        case conversationID, recipientAgentID, messageType, parentMessageID
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        role = try values.decode(String.self, forKey: .role)
        sequence = try values.decode(Int.self, forKey: .sequence)
        text = try values.decode(String.self, forKey: .text)
        createdAt = try values.decode(Date.self, forKey: .createdAt)
        conversationID = try values.decodeIfPresent(String.self, forKey: .conversationID)
        recipientAgentID = try values.decodeIfPresent(String.self, forKey: .recipientAgentID)
        messageType = try values.decodeIfPresent(String.self, forKey: .messageType)
        parentMessageID = try values.decodeIfPresent(String.self, forKey: .parentMessageID)
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(id, forKey: .id)
        try values.encode(role, forKey: .role)
        try values.encode(sequence, forKey: .sequence)
        try values.encode(text, forKey: .text)
        try values.encode(createdAt, forKey: .createdAt)
        try values.encodeIfPresent(conversationID, forKey: .conversationID)
        try values.encodeIfPresent(recipientAgentID, forKey: .recipientAgentID)
        try values.encodeIfPresent(messageType, forKey: .messageType)
        try values.encodeIfPresent(parentMessageID, forKey: .parentMessageID)
    }
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
    static let maximumCloudAttemptsPerTask = 4

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
        var recoveredCloudTaskIDs = Set<String>()
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
                if let attempts = value.cloudAnalysisAttempts {
                    value.cloudAnalysisAttempts = attempts.map { attempt in
                        guard attempt.status == .submitting else { return attempt }
                        var recovered = attempt
                        recovered.status = .unknown
                        recovered.updatedAt = now()
                        recovered.failureCode = "interrupted"
                        recovered.result = nil
                        recoveredCloudTaskIDs.insert(value.id)
                        value.updatedAt = now()
                        changed = true
                        return recovered
                    }
                }
                return value
            }
            .sorted { $0.updatedAt > $1.updatedAt }
        if changed { try write(recovered, protecting: recoveredCloudTaskIDs) }
        return recovered
    }

    /// Refresh during an active request without treating it as restart recovery.
    func snapshot() throws -> [AgentTaskHistoryEntry] {
        let cutoff = now().addingTimeInterval(-Self.retentionInterval)
        return try readTasks().filter { $0.updatedAt >= cutoff }.sorted { $0.updatedAt > $1.updatedAt }
    }

    /// Persist before dispatch. Promote the target to the archive front so the
    /// bounded writer cannot silently evict the attempt being submitted.
    func beginCloudAnalysis(request: CloudAnalysisRequest, configuration: CloudAnalysisConfiguration) throws {
        try request.validate(configuration: configuration, now: now())
        var tasks = try readTasks()
        guard let index = tasks.firstIndex(where: { $0.id == request.taskID }) else {
            throw StoreError.taskNotFound
        }
        guard tasks[index].status != .running,
              (tasks[index].cloudAnalysisAttempts ?? []).count < Self.maximumCloudAttemptsPerTask,
              !tasks.flatMap({ $0.cloudAnalysisAttempts ?? [] }).contains(where: {
                  $0.id.lowercased() == request.attemptID.lowercased() || $0.status == .submitting
              }) else {
            throw StoreError.invalidTransition
        }
        var task = tasks.remove(at: index)
        let timestamp = now()
        var attempts = task.cloudAnalysisAttempts ?? []
        attempts.append(CloudAnalysisAttempt(
            request: request, gatewayOrigin: configuration.origin.absoluteString,
            createdAt: timestamp, updatedAt: timestamp, status: .submitting,
            result: nil, failureCode: nil
        ))
        task.cloudAnalysisAttempts = attempts
        task.updatedAt = timestamp
        tasks.insert(task, at: 0)
        try write(tasks, protecting: [request.taskID])
        guard try readTasks().first(where: { $0.id == request.taskID })?
            .cloudAnalysisAttempts?.contains(where: { $0.id == request.attemptID && $0.status == .submitting }) == true else {
            throw StoreError.invalidTransition
        }
    }

    func completeCloudAnalysis(taskID: String, attemptID: String, result: CloudAnalysisResult) throws {
        try updateCloudAnalysis(taskID: taskID, attemptID: attemptID) { attempt in
            try result.validate(for: attempt.request)
            attempt.status = .completed
            attempt.result = result
            attempt.failureCode = nil
        }
    }

    func endCloudAnalysis(taskID: String, attemptID: String, outcome: CloudAnalysisRemoteOutcome, code: String) throws {
        try updateCloudAnalysis(taskID: taskID, attemptID: attemptID) { attempt in
            attempt.status = outcome == .notStarted ? .rejected : .unknown
            attempt.result = nil
            attempt.failureCode = Self.clipped(code, limit: 128)
        }
    }

    private func updateCloudAnalysis(
        taskID: String, attemptID: String, update: (inout CloudAnalysisAttempt) throws -> Void
    ) throws {
        var tasks = try readTasks()
        guard let index = tasks.firstIndex(where: { $0.id == taskID }) else { throw StoreError.taskNotFound }
        var task = tasks.remove(at: index)
        guard task.status != .running, var attempts = task.cloudAnalysisAttempts,
              let attemptIndex = attempts.firstIndex(where: { $0.id == attemptID }),
              attempts[attemptIndex].status == .submitting else { throw StoreError.invalidTransition }
        try update(&attempts[attemptIndex])
        attempts[attemptIndex].updatedAt = now()
        task.cloudAnalysisAttempts = attempts
        task.updatedAt = now()
        tasks.insert(task, at: 0)
        try write(tasks, protecting: [taskID])
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

    func appendRoleResult(taskID: String, result: AgentTaskRoleResult) throws {
        var tasks = try readTasks()
        guard let index = tasks.firstIndex(where: { $0.id == taskID }) else {
            throw StoreError.taskNotFound
        }
        guard tasks[index].status == .running,
              tasks[index].roleResults.count < Self.maximumRoleResults,
              result.sequence == tasks[index].roleResults.count,
              !result.id.isEmpty,
              !tasks[index].roleResults.contains(where: { $0.id == result.id }) else {
            throw StoreError.invalidTransition
        }
        tasks[index].roleResults.append(
            AgentTaskRoleResult(
                id: result.id,
                role: Self.clipped(result.role, limit: 128),
                sequence: result.sequence,
                text: Self.clipped(result.text, limit: Self.maximumRoleTextBytes),
                createdAt: result.createdAt,
                conversationID: result.conversationID.map { Self.clipped($0, limit: 512) },
                recipientAgentID: result.recipientAgentID.map { Self.clipped($0, limit: 128) },
                messageType: result.messageType.map { Self.clipped($0, limit: 64) },
                parentMessageID: result.parentMessageID.map { Self.clipped($0, limit: 64) }
            )
        )
        tasks[index].updatedAt = now()
        try write(tasks)
    }

    func complete(id: String, finalResponse: String) throws {
        try transition(id: id, status: .completed, roleResults: nil,
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
                    createdAt: result.createdAt,
                    conversationID: result.conversationID.map { Self.clipped($0, limit: 512) },
                    recipientAgentID: result.recipientAgentID.map { Self.clipped($0, limit: 128) },
                    messageType: result.messageType.map { Self.clipped($0, limit: 64) },
                    parentMessageID: result.parentMessageID.map { Self.clipped($0, limit: 64) }
                )
            }
        }
        if let finalResponse {
            tasks[index].finalResponse = Self.clipped(finalResponse, limit: Self.maximumRoleTextBytes)
        }
        tasks[index].failureSummary = failureSummary
        try write(tasks)
    }

    private func write(_ input: [AgentTaskHistoryEntry], protecting taskIDs: Set<String> = []) throws {
        let cutoff = now().addingTimeInterval(-Self.retentionInterval)
        var tasks = Array(input.filter { $0.updatedAt >= cutoff }.prefix(Self.maximumTasks))
        if !taskIDs.isSubset(of: Set(tasks.map(\.id))) {
            throw StoreError.invalidTransition
        }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        func encode(_ values: [AgentTaskHistoryEntry]) throws -> Data {
            try encoder.encode(Archive(version: Self.currentVersion, savedAt: now(), tasks: values))
        }
        var data = try encode(tasks)
        while data.count > Self.maximumArchiveBytes, !tasks.isEmpty {
            // Cloud request/finalization must fail before replacing the file if
            // the protected task alone exceeds the encoded archive capacity.
            // Byte limits on text do not bound JSON escape expansion.
            guard let removable = tasks.lastIndex(where: { !taskIDs.contains($0.id) }) else {
                throw CocoaError(.fileWriteOutOfSpace)
            }
            tasks.remove(at: removable)
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

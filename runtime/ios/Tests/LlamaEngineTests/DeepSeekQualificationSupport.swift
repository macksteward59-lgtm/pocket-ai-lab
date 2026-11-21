import CryptoKit
import Dispatch
import Foundation
#if canImport(Darwin)
import Darwin
#endif
@testable import PocketLlamaEngine

// Test-only qualification. This does not change production prompts, routing,
// the frozen recipient experiments, or any authorization boundary.
struct DeepSeekQualificationProfile: Codable, Sendable {
    struct Model: Codable, Sendable {
        let id: String
        let filename: String
        let sha256: String
        let bytes: Int
    }
    struct Runtime: Codable, Sendable { let tag: String; let commit: String }
    struct Settings: Codable, Sendable {
        let contextLength: Int
        let maxTokens: Int
        let temperature: Double
        let maxOutputBytes: Int
        let maximumDurationSeconds: Int
    }
    struct Chat: Codable, Sendable { let prefix: String; let suffix: String }
    struct Case: Codable, Sendable {
        let id: String
        let prompt: String
        let expectedAnswer: String
    }
    let schemaVersion: Int
    let id: String
    let model: Model
    let runtime: Runtime
    let settings: Settings
    let chat: Chat
    let cases: [Case]

    func prompt(for item: Case) -> String { chat.prefix + item.prompt + chat.suffix }
}

struct DeepSeekQualificationLoadedProfile: Sendable {
    let profile: DeepSeekQualificationProfile
    let sha256: String
    let byteCount: Int
}

struct DeepSeekQualificationTrial: Encodable, Sendable, Equatable {
    let ordinal: Int
    let caseID: String
    let requestID: UUID?
    let profileSHA256: String
    let modelArtifactSHA256: String
    let promptSHA256: String
    let rawOutput: String?
    let status: String
    let parsedAnswer: String?
    let expectedAnswer: String
    let validFinalJSON: Bool
    let scoredCorrect: Bool
    let errorMessage: String?
    let latencyMilliseconds: Int
    let processPeakRSSBytes: Int?

    private enum CodingKeys: String, CodingKey {
        case ordinal, caseID, requestID, profileSHA256, modelArtifactSHA256, promptSHA256
        case rawOutput, status, parsedAnswer, expectedAnswer, validFinalJSON, scoredCorrect
        case errorMessage, latencyMilliseconds, processPeakRSSBytes
        case finishReason, tokenCount, timeToFirstTokenMilliseconds
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(ordinal, forKey: .ordinal)
        try c.encode(caseID, forKey: .caseID)
        try c.encode(requestID, forKey: .requestID)
        try c.encode(profileSHA256, forKey: .profileSHA256)
        try c.encode(modelArtifactSHA256, forKey: .modelArtifactSHA256)
        try c.encode(promptSHA256, forKey: .promptSHA256)
        try c.encode(rawOutput, forKey: .rawOutput)
        try c.encode(status, forKey: .status)
        try c.encode(parsedAnswer, forKey: .parsedAnswer)
        try c.encode(expectedAnswer, forKey: .expectedAnswer)
        try c.encode(validFinalJSON, forKey: .validFinalJSON)
        try c.encode(scoredCorrect, forKey: .scoredCorrect)
        try c.encode(errorMessage, forKey: .errorMessage)
        try c.encode(latencyMilliseconds, forKey: .latencyMilliseconds)
        try c.encode(processPeakRSSBytes, forKey: .processPeakRSSBytes)
        // The current native backend returns one completed text buffer. It does
        // not expose EOS/cap distinction, actual token count, or first-token time.
        try c.encodeNil(forKey: .finishReason)
        try c.encodeNil(forKey: .tokenCount)
        try c.encodeNil(forKey: .timeToFirstTokenMilliseconds)
    }
}

struct DeepSeekQualificationRun: Sendable {
    let status: String
    let elapsedMilliseconds: Int
    let modelArtifactSHA256After: String
    let modelBytesAfter: Int
    let trials: [DeepSeekQualificationTrial]
}

struct DeepSeekQualificationCleanup: Encodable, Sendable {
    let leaseReleased: Bool
    let activeLeaseCountBeforeRelease: Int
    let activeUseCountBeforeRelease: Int
    let activeRequestsBeforeRelease: Int
    let waitingRequestsBeforeRelease: Int
    let activeLeaseCount: Int
    let activeUseCount: Int
    let loadedModelIDs: [String]
    let pendingModelIDs: [String]
    let unloadingModelIDs: [String]
    let reservedMemoryMB: Int
    let activeRequests: Int
    let waitingRequests: Int

    var isClean: Bool {
        leaseReleased && activeLeaseCount == 0 && activeUseCount == 0 &&
        loadedModelIDs.isEmpty && pendingModelIDs.isEmpty && unloadingModelIDs.isEmpty &&
        reservedMemoryMB == 0 && activeRequests == 0 && waitingRequests == 0
    }
}

enum DeepSeekQualificationError: Error, Equatable {
    case invalidProfile
    case invalidModelIdentity
    case invalidModelArtifact
    case modelArtifactMismatch
    case invalidClock
    case invalidReport
}

enum DeepSeekQualification {
    static let maximumProfileBytes = 128 * 1_024
    static let maximumPromptBytes = 2_048
    static let pinTag = "b12233"
    static let pinCommit = "5f490d7bfe78844e6390c869454c149fd7e003a8"
    static let pinnedModelID = "deepseek-r1-distill-qwen-1.5b-q4_k_m"
    static let pinnedModelFilename = "DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf"
    static let pinnedModelSHA256 = "1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f"
    static let pinnedModelBytes = 1_117_320_800
    static let rssMethod = "getrusage-RUSAGE_SELF-ru_maxrss-bytes"
    static let rssScope = "whole-inference-process-high-water"

    static func loadProfile(at path: String) throws -> DeepSeekQualificationLoadedProfile {
        guard path.hasPrefix("/"),
              try URL(fileURLWithPath: path).resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else {
            throw DeepSeekQualificationError.invalidProfile
        }
        let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
        defer { try? handle.close() }
        let data = try handle.read(upToCount: maximumProfileBytes + 1) ?? Data()
        return try loadProfile(data: data)
    }

    static func loadProfile(data: Data) throws -> DeepSeekQualificationLoadedProfile {
        guard !data.isEmpty, data.count <= maximumProfileBytes,
              let profile = try? JSONDecoder().decode(DeepSeekQualificationProfile.self, from: data),
              profile.schemaVersion == 1, identifier(profile.id), identifier(profile.model.id),
              !profile.model.filename.isEmpty, profile.model.filename.utf8.count <= 256,
              !profile.model.filename.contains("/"), !profile.model.filename.contains("\\"),
              !profile.model.filename.contains("\0"), profile.model.filename.hasSuffix(".gguf"),
              isSHA256(profile.model.sha256), (24...(16 * 1_024 * 1_024 * 1_024)).contains(profile.model.bytes),
              profile.runtime.tag == pinTag, profile.runtime.commit == pinCommit,
              profile.settings.contextLength == 2_048, profile.settings.maxTokens == 512,
              profile.settings.temperature == 0, profile.settings.maxOutputBytes == 16_384,
              profile.settings.maximumDurationSeconds == 900,
              profile.chat.prefix == "<｜User｜>", profile.chat.suffix == "<｜Assistant｜><think>\n",
              profile.cases.count == 8, Set(profile.cases.map(\.id)).count == 8,
              profile.cases.allSatisfy({ item in
                  identifier(item.id) && !item.prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
                  !item.prompt.contains("\0") && item.prompt.utf8.count <= maximumPromptBytes &&
                  !item.expectedAnswer.isEmpty && item.expectedAnswer.utf8.count <= 128 &&
                  !item.expectedAnswer.contains("\0")
              }) else {
            throw DeepSeekQualificationError.invalidProfile
        }
        // Other bounded metadata/invocation/evaluation fields are retained in
        // the exact-byte profile hash and independently checked by the auditor.
        return DeepSeekQualificationLoadedProfile(profile: profile, sha256: sha256(data), byteCount: data.count)
    }

    static func requirePinnedModel(_ profile: DeepSeekQualificationProfile) throws {
        guard profile.model.id == pinnedModelID, profile.model.filename == pinnedModelFilename,
              profile.model.sha256 == pinnedModelSHA256, profile.model.bytes == pinnedModelBytes else {
            throw DeepSeekQualificationError.invalidModelIdentity
        }
    }

    static func sha256(_ bytes: Data) -> String {
        SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
    }

    static func fingerprint(_ path: String, expectedBytes: Int) throws -> (sha256: String, bytes: Int) {
        try Task.checkCancellation()
        guard expectedBytes > 0, expectedBytes <= 16 * 1_024 * 1_024 * 1_024,
              try URL(fileURLWithPath: path).resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else {
            throw DeepSeekQualificationError.invalidModelArtifact
        }
        let handle = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
        defer { try? handle.close() }
        var digest = SHA256()
        var count = 0
        while let bytes = try handle.read(upToCount: min(1_048_576, expectedBytes + 1 - count)), !bytes.isEmpty {
            try Task.checkCancellation()
            count += bytes.count
            guard count <= expectedBytes else { throw DeepSeekQualificationError.modelArtifactMismatch }
            digest.update(data: bytes)
        }
        guard count == expectedBytes else { throw DeepSeekQualificationError.modelArtifactMismatch }
        return (digest.finalize().map { String(format: "%02x", $0) }.joined(), count)
    }

    /// Require the one reasoning boundary supplied by this prefilled profile,
    /// then parse the whole suffix. No searching for JSON inside reasoning.
    static func parseFinalAnswer(_ raw: String) -> String? {
        guard raw.utf8.count <= 16_384, !raw.contains("<think>") else { return nil }
        let pieces = raw.components(separatedBy: "</think>")
        guard pieces.count == 2 else { return nil }
        var parser = DeepSeekQualificationAnswerParser(bytes: Array(pieces[1].utf8))
        return parser.parse()
    }

    /// Monotonic between-request/final budget. The workflow supplies the hard
    /// process deadline; this does not claim to interrupt a native call at 900s.
    static func run(
        runtime: NativeInferenceRuntime,
        lease: ModelPoolLease,
        loadedProfile: DeepSeekQualificationLoadedProfile,
        clock: @escaping @Sendable () -> UInt64 = { DispatchTime.now().uptimeNanoseconds },
        peakRSS: @escaping @Sendable () -> Int? = { processPeakRSSBytes() },
        onTrial: (@Sendable (DeepSeekQualificationTrial) async throws -> Void)? = nil
    ) async throws -> DeepSeekQualificationRun {
        let profile = loadedProfile.profile
        let identity = "sha256-" + profile.model.sha256
        try Task.checkCancellation()
        guard isSHA256(loadedProfile.sha256),
              lease.model.id == identity, lease.session.modelId == identity,
              lease.model.contextLength == profile.settings.contextLength else {
            throw DeepSeekQualificationError.invalidModelIdentity
        }
        guard try fingerprint(lease.model.path, expectedBytes: profile.model.bytes).sha256 == profile.model.sha256 else {
            throw DeepSeekQualificationError.modelArtifactMismatch
        }
        let started = clock()
        let budget = UInt64(profile.settings.maximumDurationSeconds) * 1_000_000_000
        var expired = false
        var trials: [DeepSeekQualificationTrial] = []
        for (index, item) in profile.cases.enumerated() {
            try Task.checkCancellation()
            if try elapsed(started, clock()) >= budget { expired = true }
            var requestID: UUID?
            var raw: String?
            var failure: String?
            var latency = 0
            let status: String
            let prompt = profile.prompt(for: item)
            if expired {
                status = "notRunBudget"
                failure = "The qualification duration budget expired."
            } else {
                let id = UUID()
                requestID = id
                let requestStarted = clock()
                let result = try await runtime.generateForEvaluation(
                    lease: lease,
                    request: GenerationRequest(requestId: id.uuidString, prompt: prompt,
                                               maxTokens: profile.settings.maxTokens,
                                               temperature: profile.settings.temperature),
                    maxOutputBytes: profile.settings.maxOutputBytes
                )
                try Task.checkCancellation()
                // Evaluation intentionally preserves ordinary errors as data,
                // but its string-only error surface must not hide cancellation.
                if result.errorMessage == String(describing: CancellationError()) { throw CancellationError() }
                if result.errorMessage == String(describing: LlamaEngineError.cancelled) { throw LlamaEngineError.cancelled }
                raw = result.output
                failure = result.errorMessage
                status = result.status.rawValue
                latency = try milliseconds(elapsed(requestStarted, clock()))
            }
            // Format is an observation even for a partial stream. Correctness
            // additionally requires successful completion of that generation.
            let parsed = raw.flatMap(parseFinalAnswer)
            let trial = DeepSeekQualificationTrial(
                ordinal: index + 1, caseID: item.id, requestID: requestID,
                profileSHA256: loadedProfile.sha256, modelArtifactSHA256: profile.model.sha256,
                promptSHA256: sha256(Data(prompt.utf8)), rawOutput: raw, status: status,
                parsedAnswer: parsed, expectedAnswer: item.expectedAnswer,
                validFinalJSON: parsed != nil,
                scoredCorrect: status == "completed" && parsed != nil && parsed == item.expectedAnswer,
                errorMessage: failure, latencyMilliseconds: latency, processPeakRSSBytes: peakRSS()
            )
            trials.append(trial)
            try await onTrial?(trial)
        }
        try Task.checkCancellation()
        let after = try fingerprint(lease.model.path, expectedBytes: profile.model.bytes)
        guard after.sha256 == profile.model.sha256 else { throw DeepSeekQualificationError.modelArtifactMismatch }
        let duration = try elapsed(started, clock())
        if duration >= budget { expired = true }
        return DeepSeekQualificationRun(status: expired ? "budgetExceeded" : "completed",
            elapsedMilliseconds: milliseconds(duration), modelArtifactSHA256After: after.sha256,
            modelBytesAfter: after.bytes, trials: trials)
    }

    static func cleanup(runtime: NativeInferenceRuntime, lease: ModelPoolLease) async throws -> DeepSeekQualificationCleanup {
        let before = await runtime.snapshot()
        let schedulerBefore = await runtime.schedulerSnapshot()
        let released = await runtime.release(lease)
        try await runtime.unload(modelId: lease.model.id)
        let after = await runtime.snapshot()
        let schedulerAfter = await runtime.schedulerSnapshot()
        return DeepSeekQualificationCleanup(
            leaseReleased: released, activeLeaseCountBeforeRelease: before.activeLeaseCount,
            activeUseCountBeforeRelease: before.activeUseCount,
            activeRequestsBeforeRelease: schedulerBefore.activeRequests, waitingRequestsBeforeRelease: schedulerBefore.waitingRequests,
            activeLeaseCount: after.activeLeaseCount, activeUseCount: after.activeUseCount,
            loadedModelIDs: after.loadedModelIDs, pendingModelIDs: after.pendingModelIDs,
            unloadingModelIDs: after.unloadingModelIDs, reservedMemoryMB: after.reservedMemoryMB,
            activeRequests: schedulerAfter.activeRequests, waitingRequests: schedulerAfter.waitingRequests
        )
    }

    static func processPeakRSSBytes() -> Int? {
        #if canImport(Darwin)
        var usage = rusage()
        guard getrusage(RUSAGE_SELF, &usage) == 0, usage.ru_maxrss >= 0 else { return nil }
        return Int(exactly: usage.ru_maxrss)
        #else
        return nil
        #endif
    }

    static func elapsed(_ start: UInt64, _ end: UInt64) throws -> UInt64 {
        guard end >= start else { throw DeepSeekQualificationError.invalidClock }
        return end - start
    }
    static func milliseconds(_ nanos: UInt64) -> Int { Int(min(nanos / 1_000_000, UInt64(Int.max))) }

    static func jsonObject<T: Encodable>(_ record: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(record))
    }
    static func emit<T: Encodable>(_ marker: String, _ record: T) throws {
        try emitObject(marker, jsonObject(record))
    }
    static func emitObject(_ marker: String, _ object: Any) throws {
        guard JSONSerialization.isValidJSONObject(object) else { throw DeepSeekQualificationError.invalidReport }
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        guard data.count <= 512 * 1_024 else { throw DeepSeekQualificationError.invalidReport }
        var line = Data((marker + " ").utf8)
        line.append(data)
        line.append(0x0A)
        FileHandle.standardOutput.write(line)
    }

    private static func identifier(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 128 && value.utf8.allSatisfy {
            (48...57).contains($0) || (65...90).contains($0) || (97...122).contains($0) || $0 == 45 || $0 == 95 || $0 == 46
        }
    }
    private static func isSHA256(_ value: String) -> Bool {
        value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

/// A one-member JSON object parser. Requiring the closing brace immediately
/// after the string value rejects duplicate keys without JSONDecoder's merging.
private struct DeepSeekQualificationAnswerParser {
    let bytes: [UInt8]
    var index = 0

    mutating func parse() -> String? {
        whitespace()
        guard take(0x7B) else { return nil }
        whitespace()
        guard string() == "answer" else { return nil }
        whitespace()
        guard take(0x3A) else { return nil }
        whitespace()
        guard let answer = string() else { return nil }
        whitespace()
        guard take(0x7D) else { return nil }
        whitespace()
        return index == bytes.count ? answer : nil
    }

    mutating func string() -> String? {
        let start = index
        guard take(0x22) else { return nil }
        while index < bytes.count {
            let byte = bytes[index]
            index += 1
            if byte == 0x22 {
                return try? JSONDecoder().decode(String.self, from: Data(bytes[start..<index]))
            }
            if byte < 0x20 { return nil }
            if byte == 0x5C {
                guard index < bytes.count else { return nil }
                let escape = bytes[index]
                index += 1
                if escape == 0x75 {
                    guard let code = unicodeEscape() else { return nil }
                    if (0xD800...0xDBFF).contains(code) {
                        guard take(0x5C), take(0x75), let low = unicodeEscape(), (0xDC00...0xDFFF).contains(low) else { return nil }
                    } else if (0xDC00...0xDFFF).contains(code) { return nil }
                } else if ![0x22, 0x5C, 0x2F, 0x62, 0x66, 0x6E, 0x72, 0x74].contains(escape) { return nil }
            }
        }
        return nil
    }

    mutating func unicodeEscape() -> Int? {
        guard index + 4 <= bytes.count else { return nil }
        var value = 0
        for _ in 0..<4 {
            let byte = bytes[index]
            index += 1
            let digit: Int
            switch byte {
            case 48...57: digit = Int(byte - 48)
            case 65...70: digit = Int(byte - 65) + 10
            case 97...102: digit = Int(byte - 97) + 10
            default: return nil
            }
            value = value * 16 + digit
        }
        return value
    }
    mutating func take(_ byte: UInt8) -> Bool {
        guard index < bytes.count, bytes[index] == byte else { return false }
        index += 1
        return true
    }
    mutating func whitespace() {
        while index < bytes.count && [0x09, 0x0A, 0x0D, 0x20].contains(bytes[index]) { index += 1 }
    }
}

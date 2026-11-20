import CryptoKit
import Dispatch
import Foundation
@testable import PocketLlamaEngine

/// Test-only, separately frozen experiment. This never changes the v1 runner,
/// production prompt handling, provider selection, or authorization.
struct RecipientFormatManifest: Decodable, Sendable {
    struct Source: Decodable, Sendable { let manifestSHA256: String }
    struct Model: Decodable, Sendable { let sha256: String; let bytes: Int }
    struct Settings: Decodable, Sendable {
        let contextLength: Int
        let maxTokens: Int
        let temperature: Double
        let maxOutputBytes: Int
        let maxPromptBytes: Int
        let maximumDurationSeconds: Int
    }
    struct Template: Decodable, Sendable {
        let text: String
        let sha256: String
        let utf8ByteLength: Int
        let prefix: String
        let suffix: String
    }
    struct Trial: Decodable, Sendable, Equatable {
        let ordinal: Int
        let sourceTrialOrdinal: Int
        let caseId: String
        let condition: String
        let format: String
        let expectedAnswer: String
        let prompt: String
        let promptSHA256: String
    }
    let schemaVersion: Int
    let suiteID: String
    let suiteVersion: String
    let sourceBenchmark: Source
    let model: Model
    let settings: Settings
    let template: Template
    let caseCount: Int
    let trialCount: Int
    let trials: [Trial]
}

struct RecipientFormatTrial: Encodable, Sendable, Equatable {
    let ordinal: Int
    let sourceTrialOrdinal: Int
    let caseId: String
    let condition: String
    let format: String
    let requestId: UUID?
    let promptSHA256: String
    let rawOutput: String?
    let status: String
    let parsedAnswer: String?
    let expectedAnswer: String
    let scoredCorrect: Bool
    let errorMessage: String?
    let latencyMilliseconds: Int

    private enum CodingKeys: String, CodingKey {
        case ordinal, sourceTrialOrdinal, caseId, condition, format, requestId
        case promptSHA256, rawOutput, status, parsedAnswer, expectedAnswer
        case scoredCorrect, errorMessage, latencyMilliseconds
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(ordinal, forKey: .ordinal)
        try c.encode(sourceTrialOrdinal, forKey: .sourceTrialOrdinal)
        try c.encode(caseId, forKey: .caseId)
        try c.encode(condition, forKey: .condition)
        try c.encode(format, forKey: .format)
        try c.encode(requestId, forKey: .requestId)
        try c.encode(promptSHA256, forKey: .promptSHA256)
        try c.encode(rawOutput, forKey: .rawOutput)
        try c.encode(status, forKey: .status)
        try c.encode(parsedAnswer, forKey: .parsedAnswer)
        try c.encode(expectedAnswer, forKey: .expectedAnswer)
        try c.encode(scoredCorrect, forKey: .scoredCorrect)
        try c.encode(errorMessage, forKey: .errorMessage)
        try c.encode(latencyMilliseconds, forKey: .latencyMilliseconds)
    }
}

struct RecipientFormatRun: Sendable {
    let status: String
    let elapsedMilliseconds: Int
    let modelArtifactSHA256After: String
    let modelBytesAfter: Int
    let trials: [RecipientFormatTrial]
}

enum RecipientFormatCalibration {
    static let manifestSHA256 = "95acbcd4237899a2234fd9c16f5e86823cec1595e6922c96cb54851d15432992"

    static func manifestData() throws -> Data {
        guard let url = Bundle.module.url(forResource: "recipient-format-calibration-v1", withExtension: "json") else {
            throw NativeRecipientTextBenchmarkError.manifestMismatch
        }
        return try Data(contentsOf: url)
    }

    static func loadManifest(data: Data? = nil) throws -> RecipientFormatManifest {
        let bytes = try data ?? manifestData()
        guard NativeLatentSHA256.digest(bytes) == manifestSHA256 else {
            throw NativeRecipientTextBenchmarkError.manifestMismatch
        }
        let manifest = try JSONDecoder().decode(RecipientFormatManifest.self, from: bytes)
        guard manifest.schemaVersion == 1,
              manifest.suiteID == "pocket-recipient-format-calibration",
              manifest.suiteVersion == "1",
              manifest.caseCount == 12, manifest.trialCount == 72,
              manifest.sourceBenchmark.manifestSHA256 == NativeRecipientTextBenchmark.manifestSHA256,
              manifest.sourceBenchmark.manifestSHA256 == NativeRecipientTextBenchmark.expectedManifestSHA256,
              manifest.trials.count == 72,
              manifest.template.text.utf8.count == manifest.template.utf8ByteLength,
              NativeLatentSHA256.digest(Data(manifest.template.text.utf8)) == manifest.template.sha256 else {
            throw NativeRecipientTextBenchmarkError.manifestMismatch
        }
        // Compare every new row against the original, unchanged Swift generator.
        // Answer keys, case/condition labels and execution order never enter prompts.
        var index = 0
        var pair = 0
        for item in NativeRecipientTextBenchmark.cases {
            for condition in item.conditionOrder {
                pair += 1
                let formats = pair.isMultiple(of: 2) ? ["chat", "raw"] : ["raw", "chat"]
                for format in formats {
                    let row = manifest.trials[index]
                    let raw = item.prompt(for: condition)
                    let expected = format == "raw" ? raw : manifest.template.prefix + raw + manifest.template.suffix
                    guard row.ordinal == index + 1, row.sourceTrialOrdinal == pair,
                          row.caseId == item.caseId, row.condition == condition.rawValue,
                          row.format == format, row.expectedAnswer == item.expectedAnswer(for: condition).rawValue,
                          row.prompt == expected, row.prompt.utf8.count <= manifest.settings.maxPromptBytes,
                          row.prompt.utf8.allSatisfy({ $0 > 0 && $0 < 0x80 }),
                          row.promptSHA256 == NativeLatentSHA256.digest(Data(row.prompt.utf8)) else {
                        throw NativeRecipientTextBenchmarkError.manifestMismatch
                    }
                    index += 1
                }
            }
        }
        return manifest
    }

    static func fingerprint(_ path: String) throws -> (sha256: String, bytes: Int) {
        try Task.checkCancellation()
        let url = URL(fileURLWithPath: path)
        guard try url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile == true else {
            throw NativeRecipientTextBenchmarkError.invalidModelArtifact
        }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        var count = 0
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
            try Task.checkCancellation()
            hash.update(data: data)
            let (next, overflow) = count.addingReportingOverflow(data.count)
            guard !overflow else { throw NativeRecipientTextBenchmarkError.invalidModelArtifact }
            count = next
        }
        try Task.checkCancellation()
        return (hash.finalize().map { String(format: "%02x", $0) }.joined(), count)
    }

    /// The digest parameter permits explicitly labelled fixture engines in unit
    /// tests. The real-model XCTest separately requires the frozen model pin.
    static func run(
        runtime: NativeInferenceRuntime,
        lease: ModelPoolLease,
        expectedModelSHA256: String,
        clock: @escaping @Sendable () -> UInt64 = { DispatchTime.now().uptimeNanoseconds },
        onTrial: (@Sendable (RecipientFormatTrial) async throws -> Void)? = nil
    ) async throws -> RecipientFormatRun {
        let manifest = try loadManifest()
        try Task.checkCancellation()
        let identity = "sha256-" + expectedModelSHA256
        guard expectedModelSHA256.utf8.count == 64,
              expectedModelSHA256.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              lease.model.id.utf8.elementsEqual(identity.utf8),
              lease.session.modelId.utf8.elementsEqual(identity.utf8),
              lease.model.contextLength == manifest.settings.contextLength else {
            throw NativeRecipientTextBenchmarkError.invalidModelIdentity
        }
        guard try fingerprint(lease.model.path).sha256 == expectedModelSHA256 else {
            throw NativeRecipientTextBenchmarkError.modelArtifactMismatch
        }
        let started = clock()
        let budget = UInt64(manifest.settings.maximumDurationSeconds) * 1_000_000_000
        var expired = false
        var trials: [RecipientFormatTrial] = []
        for row in manifest.trials {
            try Task.checkCancellation()
            if elapsed(started, clock()) >= budget { expired = true }
            var requestID: UUID?
            var output: String?
            var failure: String?
            var latency = 0
            let status: String
            if expired {
                status = "notRunBudget"
                failure = "The frozen between-request budget expired."
            } else {
                let id = UUID()
                requestID = id
                let requestStarted = clock()
                do {
                    output = try await runtime.generate(
                        lease: lease,
                        request: GenerationRequest(requestId: id.uuidString, prompt: row.prompt,
                                                   maxTokens: manifest.settings.maxTokens,
                                                   temperature: manifest.settings.temperature),
                        maxOutputBytes: manifest.settings.maxOutputBytes
                    )
                    try Task.checkCancellation()
                } catch is CancellationError {
                    throw CancellationError()
                } catch LlamaEngineError.cancelled {
                    throw LlamaEngineError.cancelled
                } catch let error as ModelPoolError {
                    throw error
                } catch {
                    try Task.checkCancellation()
                    failure = String(describing: error)
                }
                latency = milliseconds(elapsed(requestStarted, clock()))
                status = failure == nil ? "completed" : "generationFailed"
            }
            let parsed = status == "completed" ? output.flatMap(NativeRecipientTextBenchmark.parseAnswer)?.rawValue : nil
            let trial = RecipientFormatTrial(
                ordinal: row.ordinal, sourceTrialOrdinal: row.sourceTrialOrdinal,
                caseId: row.caseId, condition: row.condition, format: row.format,
                requestId: requestID, promptSHA256: row.promptSHA256, rawOutput: output,
                status: status, parsedAnswer: parsed, expectedAnswer: row.expectedAnswer,
                scoredCorrect: status == "completed" && parsed == row.expectedAnswer,
                errorMessage: failure, latencyMilliseconds: latency
            )
            trials.append(trial)
            try await onTrial?(trial)
        }
        try Task.checkCancellation()
        let after = try fingerprint(lease.model.path)
        guard after.sha256 == expectedModelSHA256 else { throw NativeRecipientTextBenchmarkError.modelArtifactMismatch }
        let duration = elapsed(started, clock())
        if duration >= budget { expired = true }
        return RecipientFormatRun(status: expired ? "budgetExceeded" : "completed",
                                  elapsedMilliseconds: milliseconds(duration),
                                  modelArtifactSHA256After: after.sha256,
                                  modelBytesAfter: after.bytes, trials: trials)
    }

    static func emit<T: Encodable>(_ marker: String, _ record: T) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        var line = Data((marker + " ").utf8)
        line.append(try encoder.encode(record))
        line.append(0x0A)
        FileHandle.standardOutput.write(line)
    }

    private static func elapsed(_ start: UInt64, _ end: UInt64) -> UInt64 { end >= start ? end - start : 0 }
    private static func milliseconds(_ nanos: UInt64) -> Int { Int(min(nanos / 1_000_000, UInt64(Int.max))) }
}

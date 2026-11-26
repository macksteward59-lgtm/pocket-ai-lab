import CryptoKit
import Dispatch
import Foundation

public enum NativeRecipientTextCondition: String, Codable, Sendable, CaseIterable, Hashable {
    case correct
    case absent
    case counterfactual
}

public enum NativeRecipientTextAnswer: String, Codable, Sendable, CaseIterable, Hashable {
    case a = "A"
    case b = "B"

    public var opposite: NativeRecipientTextAnswer { self == .a ? .b : .a }
}

/// Host-owned benchmark data. Case IDs, condition names, the seed, and answer
/// keys are report metadata; only the selected fact enters the message text.
public struct NativeRecipientTextCase: Sendable, Equatable, Encodable {
    public let caseId: String
    public let objectId: String
    public let optionA: String
    public let optionB: String
    public let correctAnswer: NativeRecipientTextAnswer
    public let conditionOrder: [NativeRecipientTextCondition]

    public func expectedAnswer(for condition: NativeRecipientTextCondition) -> NativeRecipientTextAnswer {
        condition == .counterfactual ? correctAnswer.opposite : correctAnswer
    }

    public func prompt(for condition: NativeRecipientTextCondition) -> String {
        let message: String
        if condition == .absent {
            message = "No stored word is supplied for \(objectId)."
        } else {
            let answer = expectedAnswer(for: condition)
            let word = answer == .a ? optionA : optionB
            message = "The stored word for \(objectId) is \(word)."
        }
        return "Read the message and answer the question.\n" +
            "Message: \(message)\n" +
            "Question: Which word is stored for \(objectId)?\n" +
            "A: \(optionA)\n" +
            "B: \(optionB)\n" +
            "Reply with exactly A or B.\n" +
            "Answer:"
    }
}

public struct NativeRecipientTextTrial: Sendable, Equatable, Encodable {
    public enum Status: String, Codable, Sendable, Equatable {
        case completed
        case generationFailed
        case notRunBudget
    }

    /// One-based position in the frozen 36-request schedule.
    public let ordinal: Int
    public let caseId: String
    public let condition: NativeRecipientTextCondition
    public let requestId: UUID?
    public let promptSHA256: String
    /// Exact text returned by runtime.generate. A thrown request exposes no
    /// partial buffer, so failures and unstarted requests record nil, not "".
    public let rawOutput: String?
    public let status: Status
    public let parsedAnswer: NativeRecipientTextAnswer?
    public let expectedAnswer: NativeRecipientTextAnswer
    public let scoredCorrect: Bool
    public let errorMessage: String?
    public let latencyMilliseconds: Int

    private enum CodingKeys: String, CodingKey {
        case ordinal, caseId, condition, requestId, promptSHA256, rawOutput
        case status, parsedAnswer, expectedAnswer, scoredCorrect, errorMessage, latencyMilliseconds
    }

    public func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(ordinal, forKey: .ordinal)
        try values.encode(caseId, forKey: .caseId)
        try values.encode(condition, forKey: .condition)
        try values.encode(requestId, forKey: .requestId)
        try values.encode(promptSHA256, forKey: .promptSHA256)
        try values.encode(rawOutput, forKey: .rawOutput)
        try values.encode(status, forKey: .status)
        try values.encode(parsedAnswer, forKey: .parsedAnswer)
        try values.encode(expectedAnswer, forKey: .expectedAnswer)
        try values.encode(scoredCorrect, forKey: .scoredCorrect)
        try values.encode(errorMessage, forKey: .errorMessage)
        try values.encode(latencyMilliseconds, forKey: .latencyMilliseconds)
    }
}

/// All accuracy denominators remain the scheduled case count. Failed, invalid,
/// and unstarted trials score zero; budget-incomplete runs are marked separately
/// and cannot be represented as complete quality measurements.
public struct NativeRecipientTextMetrics: Sendable, Equatable, Encodable {
    public let caseCount: Int
    public let scheduledTrialCount: Int
    public let attemptedTrialCount: Int
    public let completedTrialCount: Int
    public let generationFailedCount: Int
    public let invalidAnswerCount: Int
    public let notRunBudgetCount: Int
    public let correctAnswerCount: Int
    public let absentAnswerCount: Int
    public let counterfactualFollowingCount: Int
    public let correctAccuracy: Double
    public let absentAccuracy: Double
    public let counterfactualFollowingRate: Double
    public let correctMinusAbsentAccuracy: Double
    public let correctOnlyVsAbsentCount: Int
    public let absentOnlyVsCorrectCount: Int
    /// Both outputs must follow their specific, opposite answer keys. Merely
    /// producing different text does not count as a successful switch.
    public let correctAndCounterfactualPairCount: Int
    public let correctAndCounterfactualPairRate: Double
}

public struct NativeRecipientTextBenchmarkRun: Sendable, Equatable, Encodable {
    public enum Status: String, Codable, Sendable, Equatable {
        case completed
        case budgetExceeded
    }

    public let suiteID: String
    public let suiteVersion: String
    public let manifestSHA256: String
    public let modelId: String
    public let modelArtifactSHA256: String
    /// Derived from the runtime-owned engine. It identifies the provider, not
    /// whether a particular failed request completed native inference.
    public let providerKind: String
    public let status: Status
    public let maximumDurationSeconds: Int
    public let elapsedMilliseconds: Int
    public let trials: [NativeRecipientTextTrial]
    public let metrics: NativeRecipientTextMetrics
}

public enum NativeRecipientTextBenchmarkError: Error, Equatable, Sendable {
    case invalidModelIdentity
    case invalidModelArtifact
    case modelArtifactMismatch
    case manifestMismatch
}

/// A frozen text-reference feasibility measurement using the existing runtime.
/// It does not train a mapper, ingest GIE, enable a route, or grant authority.
public enum NativeRecipientTextBenchmark {
    public static let suiteID = "pocket-recipient-private-facts"
    public static let suiteVersion = "1"
    public static let seed: UInt64 = 0x50414C5245435631
    public static let maxPromptBytes = 512
    public static let maxTokens = 4
    public static let temperature: Double = 0
    public static let maxOutputBytes = 128
    public static let maximumDurationSeconds = 900
    public static let expectedManifestSHA256 = "376b9eef0c0b6b935307a4e9b2ce48ad5780281a1944394ac7a174a40ca3a51d"

    public static let cases: [NativeRecipientTextCase] = {
        let orders: [[NativeRecipientTextCondition]] = [
            [.correct, .absent, .counterfactual],
            [.correct, .counterfactual, .absent],
            [.absent, .correct, .counterfactual],
            [.absent, .counterfactual, .correct],
            [.counterfactual, .correct, .absent],
            [.counterfactual, .absent, .correct]
        ]
        var generator = RecipientTextSplitMix64(state: seed)
        var result: [NativeRecipientTextCase] = []
        for (orderIndex, order) in orders.enumerated() {
            for answer in NativeRecipientTextAnswer.allCases {
                // The nonce consumes one PRNG draw and never uses the answer key.
                let nonce = String(generator.next() & 0xFFFF_FFFF, radix: 16, uppercase: true)
                let objectId = "OBJ-" + String(repeating: "0", count: 8 - nonce.count) + nonce
                let ordinal = String(result.count + 1)
                result.append(NativeRecipientTextCase(
                    caseId: "case-" + String(repeating: "0", count: 2 - ordinal.count) + ordinal,
                    objectId: objectId,
                    optionA: orderIndex.isMultiple(of: 2) ? "cedar" : "maple",
                    optionB: orderIndex.isMultiple(of: 2) ? "maple" : "cedar",
                    correctAnswer: answer,
                    conditionOrder: order
                ))
            }
        }
        return result
    }()

    /// Canonical format: an ASCII header followed by ordered fields encoded as
    /// name:decimal-UTF8-length LF, exact UTF-8 value bytes, LF. Prompt newlines
    /// are therefore unambiguous. This does not depend on JSON encoder behavior.
    public static var manifestData: Data {
        var bytes = Data("PAL-RECIPIENT-TEXT-MANIFEST-1\n".utf8)
        func field(_ name: String, _ value: String) {
            bytes.append(contentsOf: "\(name):\(value.utf8.count)\n".utf8)
            bytes.append(contentsOf: value.utf8)
            bytes.append(0x0A)
        }
        field("suiteID", suiteID)
        field("suiteVersion", suiteVersion)
        let seedHex = String(seed, radix: 16)
        field("seed", String(repeating: "0", count: 16 - seedHex.count) + seedHex)
        field("generator", "splitmix64-v1;nonce-low32-uppercase8hex;one-draw-per-case;six-permutations-each-A-then-B;options-swap-on-odd-permutation")
        field("source", "host-generated-private-facts")
        field("promptFormat", "plain-ascii-v1")
        field("maxPromptBytes", String(maxPromptBytes))
        field("maxTokens", String(maxTokens))
        field("temperature", temperature == 0 ? "0" : String(temperature))
        field("maxOutputBytes", String(maxOutputBytes))
        field("maximumDurationSeconds", String(maximumDurationSeconds))
        field("parser", "trim-bytes-09-0a-0d-20;exact-A-or-B;completed-only")
        field("scoring", "fixed-case-denominator;failed-invalid-unrun-score-zero;counterfactual-key-is-opposite")
        field("pairedMetrics", "correct-only-minus-absent-only;correct-and-counterfactual-both-follow-specific-keys")
        field("budget", "monotonic-check-between-requests;unstarted-rows-notRunBudget;no-hard-per-call-timeout")
        field("caseCount", String(cases.count))
        field("trialCount", String(cases.count * 3))
        var ordinal = 0
        for item in cases {
            field("case.id", item.caseId)
            field("case.objectId", item.objectId)
            field("case.optionA", item.optionA)
            field("case.optionB", item.optionB)
            field("case.correctAnswer", item.correctAnswer.rawValue)
            field("case.conditionOrder", item.conditionOrder.map(\.rawValue).joined(separator: ","))
            for condition in item.conditionOrder {
                ordinal += 1
                field("trial.ordinal", String(ordinal))
                field("trial.condition", condition.rawValue)
                field("trial.expectedAnswer", item.expectedAnswer(for: condition).rawValue)
                field("trial.prompt", item.prompt(for: condition))
            }
        }
        return bytes
    }

    public static var manifestSHA256: String { NativeLatentSHA256.digest(manifestData) }

    public static func parseAnswer(_ output: String) -> NativeRecipientTextAnswer? {
        let bytes = Array(output.utf8)
        var lower = 0
        var upper = bytes.count
        while lower < upper && isEdgeWhitespace(bytes[lower]) { lower += 1 }
        while upper > lower && isEdgeWhitespace(bytes[upper - 1]) { upper -= 1 }
        guard upper - lower == 1 else { return nil }
        switch bytes[lower] {
        case 0x41: return .a
        case 0x42: return .b
        default: return nil
        }
    }

    /// Verifies the content-addressed model before and after the frozen schedule.
    /// The caller owns the lease. Each inference uses the existing scheduler and
    /// cancellation drain. The 900-second limit is checked between requests;
    /// an already-running native call can exceed it before returning.
    public static func run(
        runtime: NativeInferenceRuntime,
        lease: ModelPoolLease,
        expectedModelSHA256: String,
        onTrial: (@Sendable (NativeRecipientTextTrial) async -> Void)? = nil
    ) async throws -> NativeRecipientTextBenchmarkRun {
        try await run(
            runtime: runtime,
            lease: lease,
            expectedModelSHA256: expectedModelSHA256,
            monotonicNanoseconds: { DispatchTime.now().uptimeNanoseconds },
            onTrial: onTrial
        )
    }

    /// Internal deterministic clock seam; it never changes the frozen deadline.
    static func run(
        runtime: NativeInferenceRuntime,
        lease: ModelPoolLease,
        expectedModelSHA256: String,
        monotonicNanoseconds: @escaping @Sendable () -> UInt64,
        onTrial: (@Sendable (NativeRecipientTextTrial) async -> Void)? = nil
    ) async throws -> NativeRecipientTextBenchmarkRun {
        try Task.checkCancellation()
        guard manifestSHA256 == expectedManifestSHA256 else {
            throw NativeRecipientTextBenchmarkError.manifestMismatch
        }
        let expectedModelId = "sha256-\(expectedModelSHA256)"
        guard expectedModelSHA256.utf8.count == 64,
              expectedModelSHA256.utf8.allSatisfy({ (0x30...0x39).contains($0) || (0x61...0x66).contains($0) }),
              lease.model.id.utf8.elementsEqual(expectedModelId.utf8),
              lease.session.modelId.utf8.elementsEqual(expectedModelId.utf8) else {
            throw NativeRecipientTextBenchmarkError.invalidModelIdentity
        }
        guard try fingerprint(path: lease.model.path) == expectedModelSHA256 else {
            throw NativeRecipientTextBenchmarkError.modelArtifactMismatch
        }

        let started = monotonicNanoseconds()
        let budget = UInt64(maximumDurationSeconds) * 1_000_000_000
        var budgetExceeded = false
        var trials: [NativeRecipientTextTrial] = []
        for item in cases {
            for condition in item.conditionOrder {
                try Task.checkCancellation()
                let prompt = item.prompt(for: condition)
                guard prompt.utf8.count <= maxPromptBytes, prompt.utf8.allSatisfy({ $0 < 0x80 }) else {
                    throw NativeRecipientTextBenchmarkError.manifestMismatch
                }
                let promptSHA256 = NativeLatentSHA256.digest(Data(prompt.utf8))
                let expectedAnswer = item.expectedAnswer(for: condition)
                let ordinal = trials.count + 1
                if elapsedNanoseconds(started: started, now: monotonicNanoseconds()) >= budget {
                    budgetExceeded = true
                }
                let trial: NativeRecipientTextTrial
                if budgetExceeded {
                    trial = NativeRecipientTextTrial(
                        ordinal: ordinal, caseId: item.caseId, condition: condition,
                        requestId: nil, promptSHA256: promptSHA256, rawOutput: nil,
                        status: .notRunBudget, parsedAnswer: nil, expectedAnswer: expectedAnswer,
                        scoredCorrect: false,
                        errorMessage: "The fixed run budget elapsed before this request started.",
                        latencyMilliseconds: 0
                    )
                } else {
                    let requestId = UUID()
                    let requestStarted = monotonicNanoseconds()
                    var output: String?
                    var failure: String?
                    do {
                        output = try await runtime.generate(
                            lease: lease,
                            request: GenerationRequest(
                                requestId: requestId.uuidString,
                                prompt: prompt, maxTokens: maxTokens, temperature: temperature
                            ),
                            maxOutputBytes: maxOutputBytes
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
                    let parsed = failure == nil ? output.flatMap(parseAnswer) : nil
                    trial = NativeRecipientTextTrial(
                        ordinal: ordinal, caseId: item.caseId, condition: condition,
                        requestId: requestId, promptSHA256: promptSHA256, rawOutput: output,
                        status: failure == nil ? .completed : .generationFailed,
                        parsedAnswer: parsed, expectedAnswer: expectedAnswer,
                        scoredCorrect: failure == nil && parsed == expectedAnswer,
                        errorMessage: failure,
                        latencyMilliseconds: milliseconds(started: requestStarted, now: monotonicNanoseconds())
                    )
                }
                trials.append(trial)
                if let onTrial { await onTrial(trial) }
                try Task.checkCancellation()
            }
        }
        try Task.checkCancellation()
        guard try fingerprint(path: lease.model.path) == expectedModelSHA256 else {
            throw NativeRecipientTextBenchmarkError.modelArtifactMismatch
        }
        let ended = monotonicNanoseconds()
        if elapsedNanoseconds(started: started, now: ended) >= budget { budgetExceeded = true }
        return NativeRecipientTextBenchmarkRun(
            suiteID: suiteID, suiteVersion: suiteVersion, manifestSHA256: manifestSHA256,
            modelId: lease.model.id, modelArtifactSHA256: expectedModelSHA256,
            providerKind: runtime.providerKind.rawValue,
            status: budgetExceeded ? .budgetExceeded : .completed,
            maximumDurationSeconds: maximumDurationSeconds,
            elapsedMilliseconds: milliseconds(started: started, now: ended),
            trials: trials, metrics: metrics(for: trials)
        )
    }

    private static func isEdgeWhitespace(_ byte: UInt8) -> Bool {
        byte == 0x09 || byte == 0x0A || byte == 0x0D || byte == 0x20
    }

    private static func elapsedNanoseconds(started: UInt64, now: UInt64) -> UInt64 {
        now >= started ? now - started : 0
    }

    private static func milliseconds(started: UInt64, now: UInt64) -> Int {
        Int(min(elapsedNanoseconds(started: started, now: now) / 1_000_000, UInt64(Int.max)))
    }

    private static func fingerprint(path: String) throws -> String {
        try Task.checkCancellation()
        let url = URL(fileURLWithPath: path)
        let values = try url.resourceValues(forKeys: [.isRegularFileKey])
        guard values.isRegularFile == true else { throw NativeRecipientTextBenchmarkError.invalidModelArtifact }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hasher = SHA256()
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
            try Task.checkCancellation()
            hasher.update(data: chunk)
        }
        try Task.checkCancellation()
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func metrics(for trials: [NativeRecipientTextTrial]) -> NativeRecipientTextMetrics {
        func correctCount(_ condition: NativeRecipientTextCondition) -> Int {
            trials.filter { $0.condition == condition && $0.scoredCorrect }.count
        }
        let correct = correctCount(.correct)
        let absent = correctCount(.absent)
        let counterfactual = correctCount(.counterfactual)
        var correctOnly = 0
        var absentOnly = 0
        var switched = 0
        for item in cases {
            let itemTrials = trials.filter { $0.caseId == item.caseId }
            let correctPassed = itemTrials.first { $0.condition == .correct }?.scoredCorrect == true
            let absentPassed = itemTrials.first { $0.condition == .absent }?.scoredCorrect == true
            let counterfactualPassed = itemTrials.first { $0.condition == .counterfactual }?.scoredCorrect == true
            if correctPassed && !absentPassed { correctOnly += 1 }
            if absentPassed && !correctPassed { absentOnly += 1 }
            if correctPassed && counterfactualPassed { switched += 1 }
        }
        let denominator = Double(cases.count)
        return NativeRecipientTextMetrics(
            caseCount: cases.count, scheduledTrialCount: cases.count * 3,
            attemptedTrialCount: trials.filter { $0.status != .notRunBudget }.count,
            completedTrialCount: trials.filter { $0.status == .completed }.count,
            generationFailedCount: trials.filter { $0.status == .generationFailed }.count,
            invalidAnswerCount: trials.filter { $0.status == .completed && $0.parsedAnswer == nil }.count,
            notRunBudgetCount: trials.filter { $0.status == .notRunBudget }.count,
            correctAnswerCount: correct, absentAnswerCount: absent, counterfactualFollowingCount: counterfactual,
            correctAccuracy: Double(correct) / denominator,
            absentAccuracy: Double(absent) / denominator,
            counterfactualFollowingRate: Double(counterfactual) / denominator,
            correctMinusAbsentAccuracy: Double(correct - absent) / denominator,
            correctOnlyVsAbsentCount: correctOnly, absentOnlyVsCorrectCount: absentOnly,
            correctAndCounterfactualPairCount: switched,
            correctAndCounterfactualPairRate: Double(switched) / denominator
        )
    }
}

/// The exact wrapping arithmetic is part of generator version splitmix64-v1.
private struct RecipientTextSplitMix64 {
    var state: UInt64

    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var value = state
        value = (value ^ (value >> 30)) &* 0xBF58476D1CE4E5B9
        value = (value ^ (value >> 27)) &* 0x94D049BB133111EB
        return value ^ (value >> 31)
    }
}

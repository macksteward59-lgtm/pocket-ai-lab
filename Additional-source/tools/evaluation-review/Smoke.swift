import Foundation

/// Exercise the real journal and exporter with a synthetic record. No model or device evidence is asserted.
@main
enum JournalReviewSmoke {
    static func main() async throws {
        let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let journalURL = directory.appendingPathComponent("test-journal.ndjson")
        let journal = try NativeEvaluationJournal(fileURL: journalURL)
        let prompt = "List café / 茶."
        let output = "café\n茶"
        let start = Date(timeIntervalSince1970: 1_700_000_000.125)
        let attempt = NativeEvaluationAttemptDraft(
            id: "attempt-1", category: .taskCompletion, suiteID: "export-check", suiteVersion: "1",
            caseID: "unicode-roundtrip", evaluationCriteria: "Retain exact UTF-8.", expectedOutcome: output,
            scoringRule: .exactMatch, deterministicPassed: true, deterministicScore: 1,
            modelID: "fixture", modelArtifactSHA256: String(repeating: "a", count: 64),
            runtimeSessionID: "fixture-session", requestID: "request-1", prompt: prompt, output: output,
            status: .completed, providerKind: .unverifiedProvider, nativeExecutionObserved: false,
            errorMessage: nil, startedAt: start, completedAt: start.addingTimeInterval(0.0625),
            latencyMilliseconds: 62, maxTokens: 32, estimatedMemoryMB: 16,
            promptUTF8Bytes: prompt.utf8.count, outputUTF8Bytes: output.utf8.count)
        _ = try await journal.appendAttempt(attempt)
        let reopened = try NativeEvaluationJournal(fileURL: journalURL)
        guard let event = try await reopened.events().first else { throw CocoaError(.fileReadCorruptFile) }
        try NativeEvaluationJournal.exportAttempt(event).write(to: directory.appendingPathComponent("attempt.json"))
        print(event.eventHash)
    }
}

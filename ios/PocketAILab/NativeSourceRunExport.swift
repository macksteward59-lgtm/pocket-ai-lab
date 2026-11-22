import CryptoKit
import Foundation

struct NativeSourceRunExport {
    static let format = "pocket-ai-lab.source-run.v1"

    let id: UUID
    let events: [NativeEvaluationJournalEvent]
    let expectedCount: Int

    static func latest(in history: [NativeEvaluationJournalEvent], modelID: String?,
                       cases: [NativeEvaluationCase]) -> Self? {
        guard let modelID, let suite = cases.first else { return nil }
        let matching = history.filter {
            guard let attempt = $0.payload.attempt else { return false }
            return attempt.modelID == modelID && attempt.suiteID == suite.suiteID &&
                attempt.suiteVersion == suite.suiteVersion && attempt.sourceRunID != nil
        }
        guard let latest = matching.last?.payload.attempt, let runID = latest.sourceRunID else { return nil }
        let events = matching.filter { $0.payload.attempt?.sourceRunID == runID }
        let attempts = events.compactMap(\.payload.attempt)
        guard attempts.map(\.caseID) == Array(cases.prefix(attempts.count)).map(\.caseID),
              attempts.allSatisfy({ $0.runtimeSessionID == latest.runtimeSessionID &&
                                    $0.modelArtifactSHA256 == latest.modelArtifactSHA256 }),
              Set(attempts.map(\.requestID)).count == attempts.count else { return nil }
        return Self(id: runID, events: events, expectedCount: cases.count)
    }

    var digest: String {
        let lines = [Self.format, id.uuidString] + events.map(\.eventHash)
        return SHA256.hash(data: Data(lines.joined(separator: "\n").utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    func export() throws -> Data {
        let packets = try events.map { event in
            try JSONSerialization.jsonObject(with: NativeEvaluationJournal.exportAttempt(event))
        }
        return try JSONSerialization.data(withJSONObject: [
            "format": Self.format, "runID": id.uuidString, "events": packets, "runSHA256": digest
        ], options: [.sortedKeys, .withoutEscapingSlashes])
    }
}

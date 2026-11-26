import SwiftUI

struct NativeEvaluationHistoryView: View {
    let events: [NativeEvaluationJournalEvent]
    let selectedModelID: String?
    @Environment(\.dismiss) private var dismiss

    private var attempts: [NativeEvaluationAttempt] {
        events.compactMap(\.payload.attempt)
    }

    private var summary: NativeEvaluationScoreSummary {
        guard let selectedModelID else { return NativeEvaluationScoreSummary(attempts: []) }
        let current = attempts.filter {
            $0.modelID == selectedModelID &&
            $0.suiteID == NativeEvaluationSuite.id &&
            $0.suiteVersion == NativeEvaluationSuite.version
        }
        return NativeEvaluationScoreSummary(attempts: current)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 8) {
                Text(summary.displayText)
                    .font(.subheadline.bold())
                Text("Append-only local history · \(events.count) records · no automatic deletion")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                List {
                    ForEach(Array(events.reversed())) { event in
                        if let attempt = event.payload.attempt {
                            DisclosureGroup {
                                detail("Prompt", attempt.prompt)
                                detail("Evaluation criteria", attempt.evaluationCriteria)
                                if !attempt.expectedOutcome.isEmpty {
                                    detail("Expected outcome", attempt.expectedOutcome)
                                }
                                detail("Generated output", attempt.output.isEmpty ? "(empty output)" : attempt.output)
                                if let error = attempt.errorMessage {
                                    detail("Failure / partial result", error)
                                }
                                detail("Model ID", attempt.modelID)
                                detail("Model SHA-256", attempt.modelArtifactSHA256)
                                detail("Runtime session", attempt.runtimeSessionID)
                                detail("Request ID", attempt.requestID)
                                detail("Attempt", "\(attempt.attemptNumber) · retry of \(attempt.retryOfAttemptID ?? "none")")
                                detail("Suite", "\(attempt.suiteID) · v\(attempt.suiteVersion)")
                                detail("Execution", "\(attempt.providerKind.rawValue) · native observed: \(attempt.nativeExecutionObserved) · trust verified: \(attempt.runtimeTrustVerified)")
                                detail("Timing", "\(attempt.latencyMilliseconds) ms · max tokens \(attempt.maxTokens)")
                                detail("Resource estimate", "\(attempt.estimatedMemoryMB) MB ModelPool admission estimate · not measured resident memory")
                                detail("Payload size", "Prompt \(attempt.promptUTF8Bytes) bytes · output \(attempt.outputUTF8Bytes) bytes")
                                if let passed = attempt.deterministicPassed, let score = attempt.deterministicScore {
                                    detail("Objective check", "\(passed ? "PASS" : "FAIL") · \(Int(score * 100))%")
                                } else {
                                    detail("Objective check", "Not automatically scored · independent review required")
                                }
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(attempt.category.rawValue) · \(attempt.caseID)")
                                        .font(.subheadline.bold())
                                    Text("\(attempt.status.rawValue.capitalized) · attempt \(attempt.attemptNumber) · \(attempt.latencyMilliseconds) ms")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        } else if let assessment = event.payload.assessment {
                            DisclosureGroup {
                                detail("Evaluator", "\(assessment.evaluatorAgentID) · \(assessment.evaluatorModelID)")
                                detail("Evaluator session", assessment.evaluatorRuntimeSessionID)
                                detail("Rubric", assessment.rubricVersion)
                                detail("Overall score", "\(Int(assessment.score * 100))% · passed: \(assessment.passed)")
                                ForEach(assessment.categoryScores, id: \.category) { score in
                                    detail(score.category.rawValue, "\(Int(score.score * 100))%")
                                }
                                detail("Rationale", assessment.rationale)
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(assessment.evaluatorRole.rawValue.capitalized) assessment")
                                        .font(.subheadline.bold())
                                    Text("Assessment for attempt \(assessment.attemptID)")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        } else if let challenge = event.payload.challenge {
                            DisclosureGroup {
                                detail("Author", challenge.authorAgentID)
                                detail("Reason", challenge.reason)
                                detail("Attempt", challenge.attemptID)
                            } label: {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("Evaluation challenge")
                                        .font(.subheadline.bold())
                                    Text("Submitted by \(challenge.authorAgentID)")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                }
            }
            .padding(.top, 8)
            .navigationTitle("Self-evaluation history")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    @ViewBuilder
    private func detail(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title).font(.caption.bold()).foregroundStyle(.secondary)
            Text(value).font(.callout).textSelection(.enabled)
        }
        .padding(.vertical, 3)
    }
}

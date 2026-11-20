import SwiftUI

/// Explicit single-request disclosure. Connection credentials live only in this
/// sheet and the in-flight configuration, never in history or model context.
struct CloudAnalysisView: View {
    @ObservedObject var model: LocalChatModel
    let task: AgentTaskHistoryEntry
    @Environment(\.dismiss) private var dismiss
    @State private var origin = ""
    @State private var profileID = "pocket-analysis-v1"
    @State private var requestedModel = "deepseek-flash"
    @State private var applicationToken = ""
    @State private var inputText: String
    @State private var consent = false
    @State private var isSubmitting = false
    @State private var requestTask: Task<Void, Never>?
    @State private var validationMessage: String?

    init(model: LocalChatModel, task: AgentTaskHistoryEntry) {
        self.model = model
        self.task = task
        _inputText = State(initialValue: task.objective)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Selected task") {
                    Text(task.objective).font(.subheadline)
                    Text("Add a separate cloud assessment to this task. The local Agent Team result remains available.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section("Cloud connection") {
                    TextField("Gateway HTTPS address", text: $origin)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    TextField("Gateway profile", text: $profileID)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("DeepSeek model", text: $requestedModel)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Gateway access token", text: $applicationToken)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Text("Use an explicitly configured gateway. Its access token is kept for this sheet only. Your DeepSeek API key belongs on the server.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .disabled(isSubmitting)
                Section("Text to send") {
                    TextEditor(text: $inputText).frame(minHeight: 150).disabled(isSubmitting)
                    Text("\(inputText.utf8.count) / 4,000 bytes · standard response mode · up to 512 output tokens")
                        .font(.caption).foregroundStyle(.secondary)
                    Text("Only this selected text and task identifiers are sent to the gateway. It sends the text to DeepSeek. Other task results, conversation history and saved memories are not included.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    Toggle("Allow this one request to the displayed gateway and DeepSeek model", isOn: $consent)
                        .disabled(isSubmitting)
                    Button("Send cloud analysis") { submit() }
                        .disabled(!consent || isSubmitting || model.isBusy || inputText.utf8.count > 4_000)
                    if isSubmitting {
                        ProgressView("Waiting for cloud analysis")
                        Button("Stop waiting", role: .cancel) { requestTask?.cancel() }
                        Text("Stopping the wait does not confirm that the provider stopped processing or billing the request.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if let validationMessage {
                        Text(validationMessage).font(.caption).foregroundStyle(.secondary)
                    }
                    Text(model.cloudAnalysisStatus).font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Cloud analysis")
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Close") { dismiss() }.disabled(isSubmitting)
                }
            }
            .interactiveDismissDisabled(isSubmitting)
            .onChange(of: [origin, profileID, requestedModel, applicationToken, inputText]) { _ in
                consent = false
                validationMessage = nil
            }
            .onDisappear {
                requestTask?.cancel()
                consent = false
                applicationToken = ""
            }
        }
    }

    private func submit() {
        guard consent, !isSubmitting, !model.isBusy else { return }
        // Capture the approved values and consume consent synchronously, before
        // yielding to a Task. Later field edits cannot alter this request.
        consent = false
        do {
            guard let url = URL(string: origin) else { throw CloudAnalysisError.invalidConfiguration }
            let configuration = try CloudAnalysisConfiguration(
                origin: url, profileID: profileID, requestedModel: requestedModel,
                applicationToken: applicationToken
            )
            let request = try CloudAnalysisRequest.prepare(
                taskID: task.id, inputText: inputText, configuration: configuration, consent: true
            )
            isSubmitting = true
            validationMessage = nil
            requestTask = Task { @MainActor in
                await model.runCloudAnalysis(request: request, configuration: configuration)
                isSubmitting = false
                requestTask = nil
            }
        } catch {
            validationMessage = "Check the HTTPS gateway, profile, model, access token and selected text. Nothing was sent."
        }
    }
}

struct CloudAnalysisAttemptView: View {
    let attempt: CloudAnalysisAttempt

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Cloud analysis · \(attempt.status.rawValue.capitalized)").font(.caption.bold())
            Text("\(attempt.request.requestedModel) via \(attempt.gatewayOrigin)")
                .font(.caption2).foregroundStyle(.secondary)
            if let result = attempt.result {
                Text(result.text).textSelection(.enabled)
                Text("Reported model: \(result.actualModel) · \(result.usage.totalTokens) tokens")
                    .font(.caption2).foregroundStyle(.secondary)
                Text("Unverified cloud assessment. It grants no action permissions.")
                    .font(.caption2).foregroundStyle(.secondary)
            } else if attempt.status == .unknown {
                Text("Remote outcome unknown. This attempt is not retried automatically.")
                    .font(.caption2).foregroundStyle(.secondary)
            } else if attempt.status == .rejected {
                Text("The request was rejected before provider dispatch.")
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

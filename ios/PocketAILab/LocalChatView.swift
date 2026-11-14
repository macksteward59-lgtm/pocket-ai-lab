import SwiftUI
import PocketLlamaEngine

@MainActor
final class LocalChatModel: ObservableObject {
    @Published var modelURL: URL?
    @Published var modelName = "No model imported"
    @Published var modelFingerprintSummary = "No model fingerprint"
    @Published var status = "Import a GGUF model to begin."
    @Published var messages: [ChatLine] = []
    @Published var isBusy = false
    @Published var metalStatus = "Checking Metal runtime…"
    @Published var trustStatus = RuntimeTrustPresentation.stateLabel

    private let engine: any LlamaEngine
    private let modelDirectory: URL
    private var session: RuntimeSession?
    private var artifactFingerprint: ModelArtifactFingerprint?

    init(
        modelDirectory: URL? = nil,
        engine: any LlamaEngine = LlamaCppMetalBackend(requireMetal: true)
    ) {
        self.engine = engine
        self.modelDirectory = modelDirectory ??
            FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("Models", isDirectory: true)

        let probe = LlamaCppMetalBackend.probe()
        metalStatus = probe.linked && probe.metalDeviceUsable
            ? "llama.cpp linked · Metal available · \(probe.metalDeviceDescription)"
            : "Metal is not verified in this build. Loading will fail closed if unavailable."
    }

    func importModel(from source: URL) async throws {
        guard !isBusy else { throw LocalChatError.busy }
        isBusy = true
        defer { isBusy = false }

        // Import and validate first. A failed copy leaves the selected model
        // and its currently loaded session untouched.
        let imported = try await LocalModelImporter.importGGUF(
            from: source,
            into: modelDirectory
        )

        // A successful import changes the selected artifact. Never keep
        // generating with the previous model while the UI labels the new one.
        if let previousSession = session {
            await engine.unload(sessionId: previousSession.id)
            session = nil
        }
        modelURL = imported.url
        modelName = imported.url.lastPathComponent
        artifactFingerprint = imported.fingerprint
        modelFingerprintSummary = "SHA-256 \(imported.fingerprint.sha256.prefix(16))… · \(imported.fingerprint.byteCount) bytes"
        status = "Model imported and fingerprinted in private storage. Load the selected model before prompting. Fingerprint is integrity metadata, not attestation."
    }

    func loadModel() async {
        guard !isBusy else { return }
        guard let modelURL, let expectedFingerprint = artifactFingerprint else {
            status = "Import a .gguf model first so its SHA-256 identity is recorded."
            return
        }

        isBusy = true
        defer { isBusy = false }

        // Verify the selected file before disturbing a previously loaded session.
        // If it changed or became unreadable, unload the stale session and fail closed.
        do {
            let currentFingerprint = try await fingerprintFile(at: modelURL)
            guard currentFingerprint == expectedFingerprint else {
                if let previousSession = session {
                    await engine.unload(sessionId: previousSession.id)
                }
                session = nil
                status = "The selected model file changed after import. Re-import it before loading; no session was retained."
                return
            }
        } catch {
            if let previousSession = session {
                await engine.unload(sessionId: previousSession.id)
            }
            session = nil
            status = "Could not verify the selected model file: \(error.localizedDescription)"
            return
        }

        do {
            if let previousSession = session {
                await engine.unload(sessionId: previousSession.id)
                session = nil
            }
            let descriptor = ModelDescriptor(
                id: "sha256-\(expectedFingerprint.sha256)",
                name: modelName,
                path: modelURL.path,
                contextLength: 2048,
                quantization: "GGUF"
            )
            let loadedSession = try await engine.load(model: descriptor)

            // Detect replacement or mutation while the native loader was reading.
            // Any post-load fingerprint error must unload the just-created session.
            do {
                let afterLoadFingerprint = try await fingerprintFile(at: modelURL)
                guard afterLoadFingerprint == expectedFingerprint else {
                    throw LocalChatError.modelChanged
                }
            } catch {
                await engine.unload(sessionId: loadedSession.id)
                throw error
            }

            session = loadedSession
            status = RuntimeTrustPresentation.statusMessage(
                after: "A real llama.cpp session is loaded for SHA-256 \(expectedFingerprint.sha256.prefix(16))…"
            )
        } catch {
            session = nil
            status = "Model load failed: \(error.localizedDescription) Runtime trust remains unverified."
        }
    }

    /// Hash large model files away from the main actor so import/load checks
    /// do not freeze SwiftUI while reading multi-gigabyte GGUF artifacts.
    private func fingerprintFile(at url: URL) async throws -> ModelArtifactFingerprint {
        try await Task.detached(priority: .utility) {
            try ModelArtifactFingerprint.compute(at: url)
        }.value
    }

    func send(_ prompt: String) async {
        guard !isBusy else { return }
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard let session else {
            status = "Load the selected model before prompting."
            return
        }

        isBusy = true
        messages.append(ChatLine(role: "You", text: text))
        defer { isBusy = false }
        do {
            let stream = try await engine.generate(
                session: session,
                request: GenerationRequest(prompt: text, maxTokens: 256, temperature: 0.7)
            )
            var output = ""
            for try await token in stream { output += token.text }
            guard !output.isEmpty else { throw LocalChatError.emptyOutput }
            messages.append(ChatLine(role: "Pocket AI", text: output))
            status = RuntimeTrustPresentation.statusMessage(after: "Local generation completed.")
        } catch {
            messages.append(ChatLine(role: "Runtime", text: "Generation failed: \(error.localizedDescription)"))
            status = "Generation failed; no synthetic response was substituted. Runtime trust remains unverified."
        }
    }

    /// Runs a bounded sequential role plan over the same loaded local model session.
    /// These are logical roles, not independent models, and they cannot call tools.
    func runAgentTeam(_ objective: String) async {
        guard !isBusy else { return }
        let text = objective.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard let session else {
            status = "Load the selected model before running Agent Team."
            return
        }

        let steps = [
            NativeAgentStep(
                agentId: "reasoner",
                instructions: "Decompose the task, identify assumptions, constraints, and viable approaches. Do not claim external work."
            ),
            NativeAgentStep(
                agentId: "researcher",
                instructions: "Analyze only the supplied task and prior proposals. Separate known information from unknowns. Do not claim web research or invent citations."
            ),
            NativeAgentStep(
                agentId: "engineer",
                instructions: "Develop a concrete technical approach and identify implementation dependencies. Do not claim to have changed files or run code."
            ),
            NativeAgentStep(
                agentId: "security-analyst",
                instructions: "Review threats, trust boundaries, privacy, misuse, and failure modes. Preserve all APEX/East authorization boundaries.",
                messageType: .counterargument
            ),
            NativeAgentStep(
                agentId: "critic",
                instructions: "Challenge assumptions and earlier proposals. Find contradictions, missing cases, and simpler alternatives.",
                messageType: .counterargument
            ),
            NativeAgentStep(
                agentId: "validator",
                instructions: "Synthesize a concise result. Label unverified claims, list remaining gaps, and propose next steps. Never claim tests or external actions occurred.",
                messageType: .validation
            )
        ]

        isBusy = true
        messages.append(ChatLine(role: "You · Agent Team task", text: text))
        defer { isBusy = false }
        do {
            let task = AgentTaskRequest(
                id: UUID().uuidString,
                objective: text,
                requiredCapabilities: ["reasoning", "analysis", "engineering", "security-review", "critique", "validation"]
            )
            let coordinator = NativeAgentCoordinator(engine: engine, session: session)
            let result = try await coordinator.run(
                task: task,
                steps: steps,
                maxTokens: 192,
                temperature: 0.2
            )
            for message in result.messages {
                guard case .object(let payload) = message.payload,
                      case .string(let output)? = payload["text"] else { continue }
                messages.append(ChatLine(
                    role: "Agent Team · \(message.senderAgentId) · \(message.sequence + 1)/\(result.messages.count)",
                    text: output
                ))
            }
            status = "Agent Team completed: \(result.messages.count) sequential logical roles shared one local model session. No tools or external actions were run. Runtime trust remains unverified."
        } catch {
            messages.append(ChatLine(role: "Agent Team runtime", text: "Team run failed: \(error.localizedDescription)"))
            status = "Agent Team did not complete. No synthetic result was substituted. Runtime trust remains unverified."
        }
    }
}

struct ChatLine: Identifiable {
    let id = UUID()
    let role: String
    let text: String
}

enum LocalChatError: LocalizedError {
    case notGGUF, emptyOutput, busy, modelChanged
    var errorDescription: String? {
        switch self {
        case .notGGUF: return "Choose a GGUF model file."
        case .emptyOutput: return "The model returned no text."
        case .busy: return "Another model operation is already in progress."
        case .modelChanged: return "The model file changed while the native runtime was loading it."
        }
    }
}

private enum LocalInteractionMode: String, CaseIterable, Identifiable, Hashable {
    case chat = "Chat"
    case agentTeam = "Agent Team"
    var id: String { rawValue }
}

struct LocalChatView: View {
    @StateObject private var model = LocalChatModel()
    @State private var showImporter = false
    @State private var prompt = ""
    @State private var importError: String?
    @State private var mode: LocalInteractionMode = .chat

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.modelName).font(.headline)
                    Text(model.modelFingerprintSummary).font(.caption2).foregroundStyle(.secondary)
                    Text(model.status).font(.caption).foregroundStyle(.secondary)
                    Text(model.metalStatus).font(.caption2).foregroundStyle(.secondary)
                    Label("Runtime trust: \(model.trustStatus)", systemImage: "exclamationmark.shield")
                        .font(.caption2).foregroundStyle(.orange)
                    HStack {
                        Button("Import GGUF") { showImporter = true }
                            .buttonStyle(.bordered)
                            .disabled(model.isBusy)
                        Button("Load model") { Task { await model.loadModel() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.modelURL == nil || model.isBusy)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading).padding()
                List(model.messages) { line in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(line.role).font(.caption.bold()).foregroundStyle(.secondary)
                        Text(line.text).textSelection(.enabled)
                    }.listRowSeparator(.hidden)
                }
                VStack(spacing: 6) {
                    Picker("Interaction mode", selection: $mode) {
                        ForEach(LocalInteractionMode.allCases) { option in
                            Text(option.rawValue).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    if mode == .agentTeam {
                        Text("Six sequential logical roles share one loaded local model. They do not represent six independent models and cannot run tools.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    HStack(alignment: .bottom) {
                        TextField(mode == .chat ? "Message your local model…" : "Describe a task for Agent Team…", text: $prompt, axis: .vertical)
                            .textFieldStyle(.roundedBorder).lineLimit(1...4)
                        Button {
                            let value = prompt
                            prompt = ""
                            Task {
                                if mode == .chat {
                                    await model.send(value)
                                } else {
                                    await model.runAgentTeam(value)
                                }
                            }
                        } label: {
                            Image(systemName: mode == .chat ? "arrow.up.circle.fill" : "person.3.fill")
                                .font(.title)
                        }
                        .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isBusy)
                    }
                }.padding(.horizontal)
                Text("Model output is untrusted proposal data. It cannot approve actions or create APEX evidence.")
                    .font(.caption2).foregroundStyle(.secondary).padding(.bottom, 6)
            }
            .navigationTitle("Pocket AI Lab")
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
                do {
                    guard let url = try result.get().first else { throw LocalChatError.notGGUF }
                    Task { @MainActor in
                        do {
                            try await model.importModel(from: url)
                            importError = nil
                        } catch {
                            importError = error.localizedDescription
                        }
                    }
                } catch {
                    importError = error.localizedDescription
                }
            }
            .alert("Import failed", isPresented: Binding(get: { importError != nil },
                set: { if !$0 { importError = nil } })) {
                Button("OK", role: .cancel) { importError = nil }
            } message: { Text(importError ?? "Unknown error") }
        }
    }
}

import SwiftUI
import PocketLlamaEngine

@MainActor
final class LocalChatModel: ObservableObject {
    @Published var modelURL: URL?
    @Published var modelName = "No model imported"
    @Published var status = "Import a GGUF model to begin."
    @Published var messages: [ChatLine] = []
    @Published var isBusy = false
    @Published var metalStatus = "Checking Metal runtime…"

    private let engine = LlamaCppMetalBackend(requireMetal: true)
    private var session: RuntimeSession?

    init() {
        let probe = LlamaCppMetalBackend.probe()
        metalStatus = probe.linked && probe.metalDeviceUsable
            ? "llama.cpp linked · Metal available · \(probe.metalDeviceDescription)"
            : "Metal is not verified in this build. Loading will fail closed if unavailable."
    }

    func importModel(from source: URL) throws {
        guard source.pathExtension.lowercased() == "gguf" else { throw LocalChatError.notGGUF }
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Models", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(source.lastPathComponent)
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.copyItem(at: source, to: destination)
        modelURL = destination
        modelName = destination.lastPathComponent
        status = "Copied to this app's private model folder. Model is not loaded yet."
    }

    func loadModel() async {
        guard let modelURL else { status = "Import a .gguf model first."; return }
        isBusy = true
        defer { isBusy = false }
        do {
            if let session { await engine.unload(sessionId: session.id) }
            let descriptor = ModelDescriptor(id: UUID().uuidString, name: modelName,
                path: modelURL.path, contextLength: 2048, quantization: "GGUF")
            session = try await engine.load(model: descriptor)
            status = "A real llama.cpp model session is loaded."
        } catch {
            session = nil
            status = "Model load failed: \(error.localizedDescription)"
        }
    }

    func send(_ prompt: String) async {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, let session else { status = "Load a model before prompting."; return }
        isBusy = true
        messages.append(ChatLine(role: "You", text: text))
        defer { isBusy = false }
        do {
            let stream = try await engine.generate(session: session,
                request: GenerationRequest(prompt: text, maxTokens: 256, temperature: 0.7))
            var output = ""
            for try await token in stream { output += token.text }
            guard !output.isEmpty else { throw LocalChatError.emptyOutput }
            messages.append(ChatLine(role: "Pocket AI", text: output))
            status = "Local generation completed. Output is untrusted proposal data, never authorization."
        } catch {
            messages.append(ChatLine(role: "Runtime", text: "Generation failed: \(error.localizedDescription)"))
            status = "Generation failed; no synthetic response was substituted."
        }
    }
}

struct ChatLine: Identifiable {
    let id = UUID()
    let role: String
    let text: String
}

enum LocalChatError: LocalizedError {
    case notGGUF, emptyOutput
    var errorDescription: String? {
        switch self {
        case .notGGUF: return "Choose a GGUF model file."
        case .emptyOutput: return "The model returned no text."
        }
    }
}

struct LocalChatView: View {
    @StateObject private var model = LocalChatModel()
    @State private var showImporter = false
    @State private var prompt = ""
    @State private var importError: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.modelName).font(.headline)
                    Text(model.status).font(.caption).foregroundStyle(.secondary)
                    Text(model.metalStatus).font(.caption2).foregroundStyle(.secondary)
                    HStack {
                        Button("Import GGUF") { showImporter = true }.buttonStyle(.bordered)
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
                HStack(alignment: .bottom) {
                    TextField("Message your local model…", text: $prompt, axis: .vertical)
                        .textFieldStyle(.roundedBorder).lineLimit(1...4)
                    Button {
                        let value = prompt
                        prompt = ""
                        Task { await model.send(value) }
                    } label: { Image(systemName: "arrow.up.circle.fill").font(.title) }
                    .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isBusy)
                }.padding(.horizontal)
                Text("Local model output cannot approve actions or create APEX evidence.")
                    .font(.caption2).foregroundStyle(.secondary).padding(.bottom, 6)
            }
            .navigationTitle("Pocket AI Lab")
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
                do {
                    guard let url = try result.get().first else { throw LocalChatError.notGGUF }
                    try model.importModel(from: url)
                    importError = nil
                } catch { importError = error.localizedDescription }
            }
            .alert("Import failed", isPresented: Binding(get: { importError != nil },
                set: { if !$0 { importError = nil } })) {
                Button("OK", role: .cancel) { importError = nil }
            } message: { Text(importError ?? "Unknown error") }
        }
    }
}

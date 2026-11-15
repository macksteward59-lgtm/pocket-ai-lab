import SwiftUI
import PocketLlamaEngine
import os

@MainActor
final class LocalChatModel: ObservableObject {
    @Published var modelURL: URL?
    @Published var modelName = "No model imported"
    @Published var status = "Import a GGUF model to begin."
    @Published var messages: [ChatLine] = []
    @Published var isBusy = false
    @Published var metalStatus = "Checking Metal runtime…"
    @Published var trustStatus = RuntimeTrustPresentation.stateLabel

    private let runtime: NativeInferenceRuntime?
    private var lease: ModelPoolLease?

    init() {
        let engine = LlamaCppMetalBackend(requireMetal: true)
        do {
            let configuration = try ModelPoolConfiguration(
                maxResidentMemoryMB: 4_096,
                maxLoadedModels: 1,
                minimumFreeMemoryMB: 512
            )
            runtime = try NativeInferenceRuntime(
                engine: engine,
                poolConfiguration: configuration,
                availableMemoryMB: { Int(os_proc_available_memory() / (1_024 * 1_024)) },
                maxConcurrentRequests: 1
            )
        } catch {
            runtime = nil
            status = "Native inference runtime configuration failed: \(error.localizedDescription)"
        }

        let probe = LlamaCppMetalBackend.probe()
        metalStatus = probe.linked && probe.metalDeviceUsable
            ? "llama.cpp linked · Metal available · \(probe.metalDeviceDescription)"
            : "Metal is not verified in this build. Loading will fail closed if unavailable."
    }

    var isModelLoaded: Bool { lease != nil }

    func importModel(from source: URL) async throws {
        guard !isBusy else { throw LocalChatError.busy }
        guard lease == nil else { throw LocalChatError.modelMustBeUnloaded }
        guard source.pathExtension.lowercased() == "gguf" else { throw LocalChatError.notGGUF }

        isBusy = true
        defer { isBusy = false }
        let access = source.startAccessingSecurityScopedResource()
        defer { if access { source.stopAccessingSecurityScopedResource() } }

        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Models", isDirectory: true)
        let destination = try await Task.detached(priority: .utility) {
            try LocalGGUFImporter.copy(source: source, into: directory)
        }.value

        // Update selection only after the staged artifact has passed validation.
        modelURL = destination
        modelName = destination.lastPathComponent
        status = "GGUF header validated and copied safely to this app's private model folder. Model is not loaded yet."
    }

    func loadModel() async {
        guard !isBusy else { return }
        guard let modelURL else { status = "Import a .gguf model first."; return }
        guard let runtime else { status = "The shared native inference runtime is unavailable. Loading failed closed."; return }
        isBusy = true
        defer { isBusy = false }
        do {
            if let previous = lease {
                guard await runtime.release(previous) else {
                    status = "The previous model lease could not be released. The new model was not loaded."
                    return
                }
                lease = nil
                try await runtime.unload(modelId: previous.model.id)
            }
            let estimate = try Self.estimatedMemoryMB(for: modelURL)
            let descriptor = ModelDescriptor(
                id: UUID().uuidString,
                name: modelName,
                path: modelURL.path,
                contextLength: 2048,
                quantization: "GGUF"
            )
            lease = try await runtime.acquire(model: descriptor, estimatedMemoryMB: estimate)
            status = RuntimeTrustPresentation.statusMessage(
                after: "A real llama.cpp model session is loaded through the shared ModelPool."
            )
        } catch {
            lease = nil
            status = "Model load failed closed: \(error.localizedDescription)"
        }
    }

    func unloadModel() async {
        guard !isBusy else { return }
        guard let runtime, let current = lease else { return }
        isBusy = true
        defer { isBusy = false }
        guard await runtime.release(current) else {
            status = "The model lease was not released; the native session remains protected."
            return
        }
        do {
            try await runtime.unload(modelId: current.model.id)
            lease = nil
            status = "Model unloaded after its lease was released."
        } catch {
            lease = nil
            status = "Model lease released, but native unload did not complete: \(error.localizedDescription)"
        }
    }

    func send(_ prompt: String) async {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !isBusy else { return }
        guard !text.isEmpty, let runtime, let lease else {
            status = "Load a model before prompting."
            return
        }
        isBusy = true
        messages.append(ChatLine(role: "You", text: text))
        defer { isBusy = false }
        do {
            let output = try await runtime.generate(
                session: lease.session,
                request: GenerationRequest(prompt: text, maxTokens: 256, temperature: 0.7),
                maxOutputBytes: 64_000
            )
            guard !output.isEmpty else { throw LocalChatError.emptyOutput }
            messages.append(ChatLine(role: "Pocket AI", text: output))
            status = RuntimeTrustPresentation.statusMessage(
                after: "Local generation completed under the shared inference scheduler."
            )
        } catch {
            messages.append(ChatLine(role: "Runtime", text: "Generation failed: \(error.localizedDescription)"))
            status = "Generation failed; cancellation was drained before scheduler capacity was released. Runtime trust remains unverified."
        }
    }

    /// Agent Team uses the same model lease and scheduler as native chat.
    /// The returned messages remain untrusted proposals, never approvals or evidence.
    func runAgentTeam(task: AgentTaskRequest, steps: [NativeAgentStep]) async throws -> NativeAgentRunResult {
        guard !isBusy, let runtime, let lease else { throw LocalChatError.busy }
        isBusy = true
        defer { isBusy = false }
        let coordinator = runtime.makeAgentCoordinator(for: lease)
        return try await coordinator.run(task: task, steps: steps)
    }

    private static func estimatedMemoryMB(for url: URL) throws -> Int {
        let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
        guard let number = attributes[.size] as? NSNumber else {
            throw LocalChatError.memoryEstimateUnavailable
        }
        let bytes = number.int64Value
        guard bytes > 0 else { throw LocalChatError.memoryEstimateUnavailable }
        let megabyte: Int64 = 1_048_576
        let roundedMB = bytes / megabyte + (bytes % megabyte == 0 ? 0 : 1)
        guard roundedMB <= Int64(Int.max - 256) else {
            throw LocalChatError.memoryEstimateUnavailable
        }
        let fileMB = Int(roundedMB)
        // Admission hint only: file size plus a 25%/256 MB working margin.
        // It is not measured RSS and must be calibrated on physical devices.
        return fileMB + max(256, fileMB / 4)
    }
}

enum LocalGGUFImporter {
    static func copy(source: URL, into directory: URL) throws -> URL {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let destination = directory.appendingPathComponent(source.lastPathComponent)
        let sourcePath = source.standardizedFileURL.resolvingSymlinksInPath().path
        let destinationPath = destination.standardizedFileURL.resolvingSymlinksInPath().path

        // A model already inside Documents/Models must never be copied onto or
        // deleted beneath itself.
        if sourcePath == destinationPath {
            try validateHeader(at: destination)
            return destination
        }

        let staging = directory.appendingPathComponent(".\(source.lastPathComponent).\(UUID().uuidString).staging")
        do {
            try FileManager.default.copyItem(at: source, to: staging)
            try validateHeader(at: staging)
            if FileManager.default.fileExists(atPath: destination.path) {
                _ = try FileManager.default.replaceItemAt(destination, withItemAt: staging)
            } else {
                try FileManager.default.moveItem(at: staging, to: destination)
            }
            return destination
        } catch {
            try? FileManager.default.removeItem(at: staging)
            throw error
        }
    }

    private static func validateHeader(at url: URL) throws {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        guard try handle.read(upToCount: 4) == Data("GGUF".utf8) else {
            throw LocalChatError.invalidGGUFHeader
        }
    }
}

struct ChatLine: Identifiable {
    let id = UUID()
    let role: String
    let text: String
}

enum LocalChatError: LocalizedError {
    case notGGUF, emptyOutput, busy, memoryEstimateUnavailable, modelMustBeUnloaded, invalidGGUFHeader
    var errorDescription: String? {
        switch self {
        case .notGGUF: return "Choose a GGUF model file."
        case .emptyOutput: return "The model returned no text."
        case .busy: return "Another model operation is already in progress."
        case .memoryEstimateUnavailable: return "The model file size could not be used for a safe memory admission estimate."
        case .modelMustBeUnloaded: return "Unload the current model before importing or replacing a model file."
        case .invalidGGUFHeader: return "The selected file does not contain a valid GGUF magic header. The previous model file was preserved."
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
                    Label("Runtime trust: \(model.trustStatus)", systemImage: "exclamationmark.shield")
                        .font(.caption2).foregroundStyle(.orange)
                    HStack {
                        Button("Import GGUF") { showImporter = true }.buttonStyle(.bordered).disabled(model.isBusy || model.isModelLoaded)
                        Button("Load model") { Task { await model.loadModel() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(model.modelURL == nil || model.isBusy)
                        Button("Unload model") { Task { await model.unloadModel() } }
                            .buttonStyle(.bordered)
                            .disabled(model.isBusy)
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
                    Task {
                        do {
                            try await model.importModel(from: url)
                            importError = nil
                        } catch {
                            importError = error.localizedDescription
                        }
                    }
                } catch { importError = error.localizedDescription }
            }
            .alert("Import failed", isPresented: Binding(get: { importError != nil },
                set: { if !$0 { importError = nil } })) {
                Button("OK", role: .cancel) { importError = nil }
            } message: { Text(importError ?? "Unknown error") }
        }
    }
}

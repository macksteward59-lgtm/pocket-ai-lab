import SwiftUI
import UniformTypeIdentifiers

@MainActor
struct SourceAnswersView: View {
    let store: NativeMemoryStore
    @ObservedObject var model: LocalChatModel
    @State private var catalog: ProjectPassages?
    @State private var passageID = ""
    @State private var question = ""
    @State private var history: [NativeMemoryEntry] = []
    @State private var selected: NativeMemoryEntry?
    @State private var importing = false
    @State private var busy = false
    @State private var message: String?

    private var matches: [NativeMemoryEntry] {
        let text = question.trimmingCharacters(in: .whitespacesAndNewlines)
        return history.filter { text.isEmpty || $0.sourceAnswer?.draft.question.localizedCaseInsensitiveContains(text) == true }
    }

    private var savedReply: NativeMemoryEntry? {
        let query = question.trimmingCharacters(in: .whitespacesAndNewlines)
        let exact = history.filter { $0.sourceAnswer?.draft.question.caseInsensitiveCompare(query) == .orderedSame }
        let sourceIDs = Set(exact.compactMap { $0.sourceAnswer?.draft.passage.id })
        let candidates = sourceIDs.count <= 1 ? exact : exact.filter { $0.sourceAnswer?.draft.passage.id == passageID }
        return candidates.max { left, right in
            let a = left.sourceAnswer?.corrections.last?.date
            let b = right.sourceAnswer?.corrections.last?.date
            if (a == nil) != (b == nil) { return a == nil }
            return (a ?? left.createdAt) < (b ?? right.createdAt)
        }
    }

    var body: some View {
        List {
            Section("Question") {
                TextField("Ask or find a saved question", text: $question)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .accessibilityIdentifier("source-question")
                if let savedReply {
                    Button("Read saved answer") { selected = savedReply }
                }
                if let catalog {
                    Picker("Project source", selection: $passageID) {
                        ForEach(catalog.sources) { Text($0.id).tag($0.id) }
                    }
                    Button("Ask loaded model") {
                        perform {
                            if let savedReply, savedReply.sourceAnswer?.draft.passage.id == passageID {
                                selected = savedReply
                                return
                            }
                            guard let passage = catalog.sources.first(where: { $0.id == passageID }) else { throw SourceAnswerError.catalog }
                            let draft = try await model.answerProjectQuestion(question, passage: passage)
                            selected = try await store.retainSourceAnswer(draft)
                        }
                    }
                    .disabled(busy || model.isBusy || !model.isModelLoaded || question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    if !model.isModelLoaded { Text("Load a model in Local AI to ask a new question.").font(.footnote) }
                }
            }
            Section("Saved answers") {
                if matches.isEmpty { Text("No matching saved answer.").foregroundStyle(.secondary) }
                ForEach(matches) { entry in
                    if let answer = entry.sourceAnswer {
                        Button { selected = entry } label: {
                            VStack(alignment: .leading) {
                                Text(answer.draft.question).font(.headline)
                                Text(answer.current)
                                Text(answer.draft.passage.id).font(.caption)
                            }
                        }
                        .accessibilityIdentifier("source-record-" + answer.draft.requestID)
                        .swipeActions {
                            Button("Delete", role: .destructive) { perform { _ = try await store.delete(id: entry.id) } }
                        }
                    }
                }
            }
            Section {
                Button("Import answer file") { importing = true }
                Button("Open example server answer") {
                    perform {
                        guard let url = Bundle.main.url(forResource: "SourceAnswerExample", withExtension: "json") else {
                            throw SourceAnswerError.invalidFile
                        }
                        try await accept(url)
                    }
                }
            }.disabled(busy || catalog == nil)
            if let message { Text(message).foregroundStyle(.secondary) }
        }
        .navigationTitle("Source answers")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            do {
                catalog = try ProjectPassages.bundled()
                passageID = catalog?.sources.first?.id ?? ""
                try await reload()
            } catch { message = error.localizedDescription }
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
            perform {
                let url = try result.get()
                let scope = url.startAccessingSecurityScopedResource()
                defer { if scope { url.stopAccessingSecurityScopedResource() } }
                try await accept(url)
            }
        }
        .sheet(item: $selected, onDismiss: {
            Task { do { try await reload() } catch { message = error.localizedDescription } }
        }) { entry in
            SourceAnswerDetail(entry: entry, store: store)
        }
    }

    private func accept(_ url: URL) async throws {
        guard let catalog else { throw SourceAnswerError.catalog }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        let data = try handle.read(upToCount: 64 * 1024 + 1) ?? Data()
        let draft = try SourceAnswerDraft.imported(data, from: catalog)
        selected = try await store.retainSourceAnswer(draft)
    }

    private func reload() async throws {
        history = try await store.load().filter { $0.sourceAnswer != nil }.sorted { $0.createdAt > $1.createdAt }
    }

    private func perform(_ action: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true
        message = nil
        Task {
            defer { busy = false }
            do { try await action(); try await reload() }
            catch { message = error.localizedDescription }
        }
    }
}

@MainActor
private struct SourceAnswerDetail: View {
    @Environment(\.dismiss) private var dismiss
    @State var entry: NativeMemoryEntry
    let store: NativeMemoryStore
    @State private var correction = ""
    @State private var errorText: String?
    @State private var saving = false
    @State private var savedDigest: String?

    var body: some View {
        NavigationStack {
            if let answer = entry.sourceAnswer {
                Form {
                    Section("Current answer") {
                        Text(answer.draft.question)
                        Text(answer.current).accessibilityIdentifier("review-current")
                        Text(answer.corrections.isEmpty ? "Model draft" : "Owner correction · revision " + String(answer.corrections.count))
                            .font(.caption)
                    }
                    Section("Cited project passage") {
                        Text(answer.draft.passage.finding)
                        Text(answer.draft.passage.id).accessibilityIdentifier("review-citation")
                        if let url = URL(string: answer.draft.passage.url) { Link("Open original source", destination: url) }
                    }
                    Section("Owner review") {
                        TextField("Exact corrected excerpt", text: $correction)
                            .textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("review-correction")
                        Button("Save correction") {
                            saving = true
                            Task {
                                defer { saving = false }
                                do {
                                    entry = try await store.correctSourceAnswer(id: entry.id, expectedRevision: answer.corrections.count, excerpt: correction)
                                    errorText = nil
                                    correction = ""
                                    savedDigest = nil
                                } catch { errorText = error.localizedDescription }
                            }
                        }.disabled(saving || correction.isEmpty)
                        if let errorText { Text(errorText) }
                    }
                    Section("History") {
                        Text(answer.draft.excerpt).accessibilityIdentifier("review-original")
                        Text(answer.draft.origin == .imported ? "Imported model draft" : "Local runtime draft")
                        Text(answer.draft.model).font(.caption)
                        Text(answer.draft.requestID).font(.caption).textSelection(.enabled)
                        ForEach(answer.corrections.indices, id: \.self) { index in
                            Text("Owner revision " + String(index + 1) + " · " + answer.corrections[index].excerpt)
                        }
                    }
                    Section("Export") {
                        Button("Save review in Files") {
                            do {
                                let packet = try SourceReviewExport(answer)
                                let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                                                                             appropriateFor: nil, create: true)
                                try packet.save(in: documents)
                                savedDigest = packet.digest
                                errorText = nil
                            } catch { errorText = error.localizedDescription }
                        }
                        Text("Saves a readable JSON copy in On My iPhone → Pocket AI Lab → Source reviews.")
                            .font(.footnote)
                        if let savedDigest {
                            Text("Saved review SHA-256").font(.caption)
                            Text(savedDigest).font(.caption.monospaced()).textSelection(.enabled)
                                .accessibilityIdentifier("source-review-digest")
                        }
                    }
                }
                .navigationTitle("Review answer").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            }
        }
    }
}

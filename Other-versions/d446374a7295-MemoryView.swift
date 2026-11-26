import SwiftUI

@MainActor
struct MemoryView: View {
    @ObservedObject var model: LocalChatModel
    @State private var store = NativeMemoryStore.applicationDefault()
    @State private var entries: [NativeMemoryEntry] = []
    @State private var editor: MemoryDraft?
    @State private var status = "Memory is encrypted on this device. Nothing is saved automatically."
    @State private var isBusy = false
    @State private var showError = false

    var body: some View {
        NavigationStack {
            Group {
                if entries.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "brain").font(.largeTitle).foregroundStyle(.secondary)
                        Text("No saved memories").font(.headline)
                        Text("Save information explicitly. Chat messages and agent outputs are never added automatically.")
                            .multilineTextAlignment(.center).foregroundStyle(.secondary)
                    }.padding()
                } else {
                    List {
                        ForEach(entries) { entry in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(entry.layer.title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                    Spacer()
                                    Text(entry.provenance.verified ? "Verified" : "Unverified")
                                        .font(.caption2).foregroundStyle(entry.provenance.verified ? Color.green : Color.secondary)
                                    Button { editor = MemoryDraft(entry: entry) } label: {
                                        Label("Edit memory", systemImage: "pencil").labelStyle(.iconOnly)
                                    }
                                    .buttonStyle(.borderless)
                                    .accessibilityIdentifier("edit-memory-" + entry.id)
                                }
                                Text(entry.content).textSelection(.enabled)
                                HStack(spacing: 8) {
                                    Text("Source: \(entry.provenance.agentId)")
                                    if let task = entry.provenance.taskId { Text("Task: \(task)") }
                                    Text(entry.createdAt, style: .date)
                                }
                                .font(.caption2).foregroundStyle(.tertiary)
                                if !entry.provenance.sourceRefs.isEmpty {
                                    VStack(alignment: .leading) {
                                        Text("References").bold()
                                        ForEach(entry.provenance.sourceRefs.indices, id: \.self) { index in
                                            Text(verbatim: entry.provenance.sourceRefs[index])
                                        }
                                    }
                                    .font(.caption2).foregroundStyle(.secondary)
                                    .textSelection(.enabled)
                                }
                            }
                            .padding(.vertical, 4)
                            .accessibilityElement(children: .contain)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { delete(entry) } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                Button { editor = MemoryDraft(entry: entry) } label: {
                                    Label("Edit", systemImage: "pencil")
                                }.tint(.blue)
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Memory")
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    NavigationLink("Source answers") { SourceAnswersView(store: store, model: model) }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button { editor = MemoryDraft() } label: { Label("Add memory", systemImage: "plus") }
                        .disabled(isBusy)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Text(status).font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(.horizontal).padding(.vertical, 8)
                    .background(.bar)
            }
            .sheet(item: $editor) { draft in
                MemoryEditor(draft: draft, isBusy: isBusy, onSave: saveDraft)
            }
            .task { await reload() }
            .alert("Memory unavailable", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(status)
            }
        }
    }

    private func saveDraft(_ draft: MemoryDraft) {
        let refs = draft.references.map(\.text).filter { !$0.isEmpty }
        isBusy = true
        Task {
            do {
                if let id = draft.entryID {
                    let changes = refs == draft.originalReferences ? nil : refs
                    guard try await store.update(id: id, content: draft.content, sourceRefs: changes) else {
                        status = "This memory is no longer available."
                        showError = true
                        isBusy = false
                        return
                    }
                } else {
                    _ = try await store.insert(layer: draft.layer, content: draft.content, sourceRefs: refs)
                }
                await reload()
                editor = nil
            } catch {
                status = "Memory could not be saved. Check that the device is unlocked and the Keychain key is available."
                showError = true
            }
            isBusy = false
        }
    }

    private func delete(_ entry: NativeMemoryEntry) {
        isBusy = true
        Task {
            do {
                _ = try await store.delete(id: entry.id)
                await reload()
            } catch {
                status = "Memory could not be deleted. The encrypted vault was not reported as changed."
                showError = true
            }
            isBusy = false
        }
    }

    @MainActor
    private func reload() async {
        do {
            let loaded = try await store.load()
            entries = loaded.filter { $0.sourceAnswer == nil }.sorted { $0.createdAt > $1.createdAt }
            status = entries.isEmpty
                ? "No saved memories · first save creates an encrypted on-device vault"
                : "Encrypted on this device · \(entries.count) saved · no automatic capture"
        } catch NativeMemoryVaultError.keyUnavailable {
            status = "The Keychain key is unavailable. Unlock the device or restore the original key; existing encrypted data was not replaced."
            showError = true
        } catch NativeMemoryVaultError.storageUnavailable {
            status = "Unlock the device and try again. The protected memory file is not currently accessible."
            showError = true
        } catch {
            status = "Memory could not be authenticated or read. No plaintext fallback is available."
            showError = true
        }
    }
}

private struct ReferenceField: Identifiable {
    let id = UUID()
    var text = ""
}

private enum EditorFocus: Hashable {
    case content
    case reference(UUID)
}

private struct MemoryDraft: Identifiable {
    let id = UUID()
    let entryID: String?
    let originalReferences: [String]
    var content: String
    var layer: NativeMemoryLayer
    var references: [ReferenceField]

    init(entry: NativeMemoryEntry? = nil) {
        entryID = entry?.id
        originalReferences = entry?.provenance.sourceRefs ?? []
        content = entry?.content ?? ""
        layer = entry?.layer ?? .episodic
        references = entry == nil ? [ReferenceField()] : originalReferences.map { ReferenceField(text: $0) }
    }
}

private struct MemoryEditor: View {
    @Environment(\.dismiss) private var dismiss
    @FocusState private var focusedField: EditorFocus?
    @State private var draft: MemoryDraft
    let isBusy: Bool
    let onSave: (MemoryDraft) -> Void

    init(draft: MemoryDraft, isBusy: Bool, onSave: @escaping (MemoryDraft) -> Void) {
        _draft = State(initialValue: draft)
        self.isBusy = isBusy
        self.onSave = onSave
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    LabeledContent("Memory layer") {
                        Picker("Memory layer", selection: $draft.layer) {
                            ForEach(NativeMemoryLayer.allCases) { layer in
                                Text(layer.title).tag(layer)
                            }
                        }
                        .labelsHidden()
                        .disabled(draft.entryID != nil)
                    }
                    Text("Information to remember").font(.headline)
                    TextEditor(text: $draft.content)
                        .frame(height: 110)
                        .overlay(RoundedRectangle(cornerRadius: 6).stroke(.secondary.opacity(0.35)))
                        .focused($focusedField, equals: .content)
                        .accessibilityLabel("Information to remember")
                    Text("Source references (\(draft.references.count))").font(.headline)
                        .accessibilityIdentifier("memory-reference-count")
                    ForEach($draft.references) { $reference in
                        let position = draft.references.firstIndex { $0.id == reference.id }.map { $0 + 1 } ?? 0
                        HStack {
                            TextField("Reference", text: $reference.text)
                                .textFieldStyle(.roundedBorder)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($focusedField, equals: .reference(reference.id))
                                .accessibilityLabel("Reference \(position) of \(draft.references.count)")
                                .accessibilityIdentifier("memory-reference-\(position)")
                            Button {
                                let id = reference.id
                                draft.references.removeAll { $0.id == id }
                            } label: {
                                Label("Remove reference", systemImage: "minus.circle").labelStyle(.iconOnly)
                            }
                        }
                    }
                    Button("Add reference") { draft.references.append(ReferenceField()) }
                        .disabled(draft.references.count >= NativeMemoryStore.maximumSourceReferences)
                    Text("New and edited memories are unverified.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                .padding()
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .navigationTitle(draft.entryID == nil ? "Save memory" : "Edit memory")
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done typing") { focusedField = nil }
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { onSave(draft) }
                        .disabled(draft.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isBusy)
                }
            }
        }
    }
}

import SwiftUI

struct MemoryView: View {
    @State private var store = NativeMemoryStore.applicationDefault()
    @State private var entries: [NativeMemoryEntry] = []
    @State private var isEditorPresented = false
    @State private var editingID: String?
    @State private var draftContent = ""
    @State private var draftLayer: NativeMemoryLayer = .episodic
    @State private var status = "Memory is encrypted on this device. Nothing is saved automatically."
    @State private var isBusy = false
    @State private var showError = false

    var body: some View {
        NavigationStack {
            Group {
                if entries.isEmpty {
                    ContentUnavailableView(
                        "No saved memories",
                        systemImage: "brain",
                        description: Text("Save information explicitly. Chat messages and agent outputs are never added automatically.")
                    )
                } else {
                    List {
                        ForEach(entries) { entry in
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    Text(entry.layer.title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                                    Spacer()
                                    Text(entry.provenance.verified ? "Verified" : "Unverified")
                                        .font(.caption2).foregroundStyle(entry.provenance.verified ? .green : .secondary)
                                }
                                Text(entry.content).textSelection(.enabled)
                                HStack(spacing: 8) {
                                    Text("Source: \(entry.provenance.agentId)")
                                    if let task = entry.provenance.taskId { Text("Task: \(task)") }
                                    Text(entry.createdAt, style: .date)
                                }
                                .font(.caption2).foregroundStyle(.tertiary)
                            }
                            .padding(.vertical, 4)
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { delete(entry) } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                Button { beginEdit(entry) } label: {
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button { beginCreate() } label: { Image(systemName: "plus") }
                        .disabled(isBusy)
                }
            }
            .safeAreaInset(edge: .bottom) {
                Text(status).font(.caption).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity).padding(.horizontal).padding(.vertical, 8)
                    .background(.bar)
            }
            .sheet(isPresented: $isEditorPresented) {
                NavigationStack {
                    Form {
                        Picker("Memory layer", selection: $draftLayer) {
                            ForEach(NativeMemoryLayer.allCases) { layer in
                                Text(layer.title).tag(layer)
                            }
                        }
                        Section("Information to remember") {
                            TextEditor(text: $draftContent).frame(minHeight: 150)
                        }
                        Section {
                            Text("New and edited memories are unverified. Saving does not grant permissions or authorize actions.")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .navigationTitle(editingID == nil ? "Save memory" : "Edit memory")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { isEditorPresented = false }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Save") { saveDraft() }
                                .disabled(draftContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isBusy)
                        }
                    }
                }
            }
            .task { await reload() }
            .alert("Memory unavailable", isPresented: $showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(status)
            }
        }
    }

    private func beginCreate() {
        editingID = nil
        draftContent = ""
        draftLayer = .episodic
        isEditorPresented = true
    }

    private func beginEdit(_ entry: NativeMemoryEntry) {
        editingID = entry.id
        draftContent = entry.content
        draftLayer = entry.layer
        isEditorPresented = true
    }

    private func saveDraft() {
        let content = draftContent
        let editing = editingID
        isBusy = true
        Task {
            do {
                if let editing {
                    _ = try await store.update(id: editing, content: content)
                } else {
                    _ = try await store.insert(layer: draftLayer, content: content)
                }
                await reload()
                isEditorPresented = false
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
            entries = try await store.load().sorted { $0.createdAt > $1.createdAt }
            status = "Encrypted on this device · \(entries.count) saved · no automatic capture"
        } catch NativeMemoryVaultError.keyUnavailable {
            status = "Memory is locked or its Keychain key is unavailable. Existing encrypted data was not replaced."
            showError = true
        } catch {
            status = "Memory could not be authenticated or read. No plaintext fallback is available."
            showError = true
        }
    }
}

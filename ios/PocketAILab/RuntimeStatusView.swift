import SwiftUI
import PocketLlamaEngine

struct RuntimeStatusView: View {
    private let probe = LlamaCppMetalBackend.probe()
    var body: some View {
        NavigationStack {
            List {
                Section("Native runtime") {
                    statusRow("llama.cpp linked", probe.linked)
                    statusRow("Metal backend registered", probe.metalBackendRegistered)
                    statusRow("Metal device usable", probe.metalDeviceUsable)
                    LabeledContent("GPU devices", value: String(probe.gpuDeviceCount))
                    LabeledContent("llama.cpp version", value: probe.version.isEmpty ? "Not linked" : probe.version)
                    LabeledContent("Pinned tag", value: probe.pinTag.isEmpty ? "Unavailable" : probe.pinTag)
                    LabeledContent("Device", value: probe.metalDeviceDescription.isEmpty ? "Not detected" : probe.metalDeviceDescription)
                }
                Section("APEX / East trust boundary") {
                    Text("Inference produces untrusted text only. It cannot authorize actions, alter approvals, mint receipts, or bypass Director/East governance.")
                }
                Section("Physical-device acceptance") {
                    Text("Simulator success does not prove iPhone Metal execution. Verify model load, generated output, memory behavior, and thermal stability on the actual device.")
                }
            }.navigationTitle("Runtime Diagnostics")
        }
    }
    @ViewBuilder private func statusRow(_ title: String, _ value: Bool) -> some View {
        HStack {
            Text(title)
            Spacer()
            Label(value ? "Yes" : "No", systemImage: value ? "checkmark.circle.fill" : "xmark.circle.fill")
                .foregroundStyle(value ? .green : .orange)
        }
    }
}

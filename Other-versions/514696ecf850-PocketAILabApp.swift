import SwiftUI
import PocketLlamaEngine
import os

@main
struct PocketAILabApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @StateObject private var runtimeComposition = NativeRuntimeComposition()

    var body: some View {
        TabView {
            LocalChatView(runtimeDependency: runtimeComposition.dependency)
                .tabItem { Label("Local AI", systemImage: "brain.head.profile") }
            MemoryView().tabItem { Label("Memory", systemImage: "lock.shield") }
            WorkspaceView(runtimeDependency: runtimeComposition.dependency)
                .tabItem { Label("Workspace", systemImage: "globe") }
            RuntimeStatusView().tabItem { Label("Runtime", systemImage: "cpu") }
        }
        .tint(.indigo)
    }
}


/// App-lifetime owner for native inference resources. Feature views receive this
/// dependency rather than constructing competing ModelPool/Scheduler instances.
@MainActor
final class NativeRuntimeComposition: ObservableObject {
    let runtime: NativeInferenceRuntime?
    let dependency: LocalChatRuntimeDependency
    @Published private(set) var status: String

    init(
        engine: any LlamaEngine = LlamaCppMetalBackend(requireMetal: true),
        availableMemoryMB: @escaping @Sendable () -> Int = {
            Int(os_proc_available_memory() / (1_024 * 1_024))
        }
    ) {
        do {
            let configuration = try ModelPoolConfiguration(
                maxResidentMemoryMB: 4_096,
                maxLoadedModels: 1,
                minimumFreeMemoryMB: 512
            )
            let runtime = try NativeInferenceRuntime(
                engine: engine,
                poolConfiguration: configuration,
                availableMemoryMB: availableMemoryMB,
                maxConcurrentRequests: 1
            )
            self.runtime = runtime
            self.dependency = .shared(NativeModelSessionService(runtime: runtime))
            self.status = "One app-scoped native runtime is active."
        } catch {
            self.runtime = nil
            let message = "Native inference runtime configuration failed: \(error.localizedDescription)"
            self.dependency = .unavailable(message)
            self.status = message
        }
    }
}

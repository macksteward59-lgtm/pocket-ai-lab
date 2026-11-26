import SwiftUI

@main
struct PocketAILabApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    @StateObject private var model = LocalChatModel()
    var body: some View {
        TabView {
            LocalChatView(model: model).tabItem { Label("Local AI", systemImage: "brain.head.profile") }
            MemoryView(model: model).tabItem { Label("Memory", systemImage: "lock.shield") }
            WorkspaceView().tabItem { Label("Workspace", systemImage: "globe") }
            RuntimeStatusView().tabItem { Label("Runtime", systemImage: "cpu") }
        }
        .tint(.indigo)
    }
}

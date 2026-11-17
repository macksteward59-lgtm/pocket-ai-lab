import SwiftUI

@main
struct PocketAILabApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    // One app-scoped owner keeps the native runtime and its exact model lease
    // shared across the Local AI and Workspace tabs.
    @StateObject private var localChatModel = LocalChatModel()

    var body: some View {
        TabView {
            LocalChatView()
                .environmentObject(localChatModel)
                .tabItem { Label("Local AI", systemImage: "brain.head.profile") }
            MemoryView().tabItem { Label("Memory", systemImage: "lock.shield") }
            WorkspaceView()
                .environmentObject(localChatModel)
                .tabItem { Label("Workspace", systemImage: "globe") }
            RuntimeStatusView().tabItem { Label("Runtime", systemImage: "cpu") }
        }
        .tint(.indigo)
    }
}

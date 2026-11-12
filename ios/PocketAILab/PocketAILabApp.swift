import SwiftUI

@main
struct PocketAILabApp: App {
    var body: some Scene {
        WindowGroup { RootView() }
    }
}

struct RootView: View {
    var body: some View {
        TabView {
            LocalChatView().tabItem { Label("Local AI", systemImage: "brain.head.profile") }
            WorkspaceView().tabItem { Label("Workspace", systemImage: "globe") }
            RuntimeStatusView().tabItem { Label("Runtime", systemImage: "cpu") }
        }
        .tint(.indigo)
    }
}

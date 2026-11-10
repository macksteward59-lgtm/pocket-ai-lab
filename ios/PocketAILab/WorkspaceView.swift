import SwiftUI
import WebKit

struct WorkspaceView: View {
    @AppStorage("workspaceURL") private var workspaceURL = ""
    @State private var address = ""
    @State private var loadURL: URL?
    @State private var validationMessage = "Enter the HTTPS address of your deployed Pocket AI Lab workspace."

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                HStack {
                    TextField("https://private-workspace.example", text: $address)
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                    Button("Open", action: openWorkspace).buttonStyle(.borderedProminent)
                }.padding(.horizontal)
                Text(validationMessage).font(.caption).foregroundStyle(.secondary).padding(.horizontal)
                if let loadURL {
                    PrivateWorkspaceWebView(url: loadURL).clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    ContentUnavailableView("Workspace not configured",
                        systemImage: "globe",
                        description: Text("The native local AI tab works independently. Configure a reachable HTTPS workspace to use the web interface."))
                }
            }
            .navigationTitle("Web Workspace")
            .onAppear { if !workspaceURL.isEmpty { address = workspaceURL; openWorkspace() } }
        }
    }

    private func openWorkspace() {
        guard let components = URLComponents(string: address),
              let scheme = components.scheme?.lowercased(),
              scheme == "https" || (scheme == "http" && (components.host == "localhost" || components.host == "127.0.0.1")),
              let url = components.url else {
            validationMessage = "Use HTTPS. HTTP is allowed only for localhost development."
            loadURL = nil
            return
        }
        workspaceURL = url.absoluteString
        loadURL = url
        validationMessage = "Address saved on this device. The web server must enforce authentication and authorization."
    }
}

struct PrivateWorkspaceWebView: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: config)
        view.load(URLRequest(url: url))
        return view
    }
    func updateUIView(_ view: WKWebView, context: Context) {
        if view.url != url { view.load(URLRequest(url: url)) }
    }
}

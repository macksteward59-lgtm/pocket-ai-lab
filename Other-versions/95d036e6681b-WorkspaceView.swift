import SwiftUI
import WebKit

struct WorkspaceView: View {
    @AppStorage("workspaceURL") private var workspaceURL = ""
    @State private var address = ""
    @State private var loadURL: URL?
    @State private var loadRequestID = UUID()
    @State private var restoreGate = WorkspaceRestoreGate()
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
                    PrivateWorkspaceWebView(url: loadURL, requestID: loadRequestID)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                } else {
                    VStack(spacing: 10) {
                        Image(systemName: "globe").font(.largeTitle)
                        Text("Workspace not configured").font(.headline)
                        Text("The native local AI tab works independently. Configure a reachable HTTPS workspace to use the web interface.")
                            .multilineTextAlignment(.center).foregroundStyle(.secondary)
                    }.padding()
                }
            }
            .navigationTitle("Web Workspace")
            .onAppear {
                // Restore the saved workspace only once. Returning to this tab
                // must preserve the page's current navigation and form state.
                guard restoreGate.beginRestore() else { return }
                guard !workspaceURL.isEmpty else { return }
                address = workspaceURL
                openWorkspace()
            }
        }
    }

    private func openWorkspace() {
        guard let components = URLComponents(string: address),
              let url = components.url,
              isAllowedWorkspaceURL(url) else {
            validationMessage = "Use a valid HTTPS address with a host. HTTP is allowed only for localhost development."
            return
        }
        workspaceURL = url.absoluteString
        address = url.absoluteString
        loadURL = url
        loadRequestID = UUID()
        validationMessage = "Address saved on this device. The web server must enforce authentication and authorization."
    }
}

struct WorkspaceRestoreGate {
    private(set) var hasRestoredSavedAddress = false

    mutating func beginRestore() -> Bool {
        guard !hasRestoredSavedAddress else { return false }
        hasRestoredSavedAddress = true
        return true
    }
}

func isAllowedWorkspaceURL(_ url: URL) -> Bool {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          let host = components.host?.lowercased(),
          !host.isEmpty,
          let scheme = components.scheme?.lowercased(),
          components.user == nil,
          components.password == nil else {
        return false
    }

    let isLoopback = host == "localhost" || host == "127.0.0.1" || host == "::1"
    return scheme == "https" || (scheme == "http" && isLoopback)
}

struct PrivateWorkspaceWebView: UIViewRepresentable {
    let url: URL
    let requestID: UUID

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        _ = context.coordinator.shouldLoad(requestID)
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // The browser's current URL may legitimately differ after a redirect
        // or in-page navigation. Only an explicit Open request should reload.
        guard context.coordinator.shouldLoad(requestID) else { return }
        webView.load(URLRequest(url: url))
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        private(set) var lastRequestID: UUID?

        func shouldLoad(_ requestID: UUID) -> Bool {
            guard lastRequestID != requestID else { return false }
            lastRequestID = requestID
            return true
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let destination = navigationAction.request.url,
                  isAllowedWorkspaceURL(destination) else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}

import Foundation

/// Current app-level trust presentation.
///
/// This intentionally remains unverified until a production trust service can
/// validate a trusted lease bound to the active engine session and model file.
/// A successful llama.cpp load or generation must never promote this state.
enum RuntimeTrustPresentation {
    static let stateLabel = "Unverified"
    static let isVerified = false
    static let detail = "The app does not yet provision trusted runtime keys or validate a server-issued runtime lease. A loaded model is not an attested runtime."

    static func statusMessage(after event: String) -> String {
        "\(event) Runtime trust remains \(stateLabel.lowercased()). Local output is untrusted proposal data, never authorization."
    }
}

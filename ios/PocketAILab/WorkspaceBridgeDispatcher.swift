import Foundation
import WebKit
import ApexBridge

/// Main-frame WebKit ingress. The first implementation deliberately exposes
/// only read-only status/catalog queries; generation remains disabled until the
/// app-scoped runtime can provide the same lease to the challenge-gated controller.
@MainActor
final class WorkspaceBridgeDispatcher: NSObject, WKScriptMessageHandlerWithReply {
    static let messageHandlerName = "pocketAILab"
    private static let maximumMessageBytes = 40_960

    private let trustedURL: URL
    private let localChatModel: LocalChatModel
    private var isActive = true

    init(trustedURL: URL, localChatModel: LocalChatModel) {
        self.trustedURL = trustedURL
        self.localChatModel = localChatModel
    }

    func invalidate() {
        isActive = false
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard isActive else {
            replyHandler(Self.error("bridge_unavailable"), nil)
            return
        }
        let frameOrigin = Self.originURL(from: message.frameInfo.securityOrigin)
        let result = handle(
            body: message.body,
            frameOrigin: frameOrigin,
            isMainFrame: message.frameInfo.isMainFrame
        )
        replyHandler(result, nil)
    }

    /// Kept separately testable so origin, frame, schema, and action policy can
    /// be verified without constructing a live WKWebView.
    func handle(body: Any, frameOrigin: URL?, isMainFrame: Bool) -> [String: Any] {
        guard isActive else { return Self.error("bridge_unavailable") }
        guard isMainFrame else { return Self.error("main_frame_required") }
        guard let message = body as? [String: Any],
              JSONSerialization.isValidJSONObject(message),
              let encoded = try? JSONSerialization.data(withJSONObject: message),
              encoded.count <= Self.maximumMessageBytes else {
            return Self.error("invalid_message")
        }

        let messageID = message["id"] as? String ?? ""
        let action = message["action"] as? String ?? ""
        switch BridgeGate.parse(message, page: frameOrigin, trusted: trustedURL) {
        case .untrustedOrigin:
            return Self.error("untrusted_origin", id: messageID)
        case .invalidMessage:
            return Self.error("invalid_message", id: messageID)
        case .authorizationRequired:
            return Self.error("authorization_required", id: messageID)
        case .accepted:
            break
        }

        switch action {
        case "getRuntimeStatus":
            return [
                "id": messageID,
                "ok": true,
                "data": [
                    "modelLoaded": localChatModel.isModelLoaded,
                    "modelName": localChatModel.modelName,
                    "runtimeTrust": localChatModel.trustStatus,
                    "generationEnabled": false,
                    "dispatcherMode": "read-only"
                ]
            ]
        case "listModels":
            let models: [[String: Any]] = localChatModel.availableModels.map { entry in
                [
                    "id": entry.id,
                    "name": entry.name,
                    "contextLength": entry.contextLength,
                    "quantization": entry.quantization,
                    "estimatedMemoryMB": entry.estimatedMemoryMB,
                    "selected": entry.id == localChatModel.selectedModelID
                ]
            }
            return ["id": messageID, "ok": true, "data": ["models": models]]
        default:
            // validate/readiness/generation/cancellation are not wired to the
            // app-scoped lease yet. Consequential actions are rejected earlier
            // by BridgeGate and remain unavailable without native approval.
            return Self.error("action_not_enabled", id: messageID)
        }
    }

    private static func originURL(from securityOrigin: WKSecurityOrigin) -> URL? {
        guard !securityOrigin.protocol.isEmpty, !securityOrigin.host.isEmpty else { return nil }
        var components = URLComponents()
        components.scheme = securityOrigin.protocol
        components.host = securityOrigin.host
        if securityOrigin.port > 0 {
            components.port = securityOrigin.port
        }
        components.path = "/"
        return components.url
    }

    private static func error(_ code: String, id: String = "") -> [String: Any] {
        ["id": id, "ok": false, "error": code]
    }
}

import Foundation
import WebKit
import ApexBridge

/// Main-frame WebKit ingress. This initial slice is deliberately read-only:
/// it observes the app-scoped ModelPool and local catalog but cannot start,
/// stop, or generate through a model session.
@MainActor
final class WorkspaceBridgeDispatcher: NSObject, WKScriptMessageHandlerWithReply {
    static let messageHandlerName = "pocketAILab"
    private static let maximumMessageBytes = 40_960

    private let trustedURL: URL
    private let runtimeDependency: LocalChatRuntimeDependency
    private let modelCatalogStore: LocalModelCatalogStore
    private var isActive = true

    init(
        trustedURL: URL,
        runtimeDependency: LocalChatRuntimeDependency,
        modelCatalogStore: LocalModelCatalogStore? = nil
    ) {
        self.trustedURL = trustedURL
        self.runtimeDependency = runtimeDependency
        if let modelCatalogStore {
            self.modelCatalogStore = modelCatalogStore
        } else {
            let modelDirectory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("Models", isDirectory: true)
            self.modelCatalogStore = LocalModelCatalogStore(modelDirectory: modelDirectory)
        }
    }

    func invalidate() {
        isActive = false
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard isActive else {
            replyHandler(Self.error("bridge_unavailable"), nil)
            return
        }
        let frameOrigin = Self.originURL(from: message.frameInfo.securityOrigin)
        Task { @MainActor in
            let result = await self.handle(
                body: message.body,
                frameOrigin: frameOrigin,
                isMainFrame: message.frameInfo.isMainFrame
            )
            replyHandler(result, nil)
        }
    }

    /// Separating parsing/routing from WKScriptMessage makes the trust policy
    /// testable without constructing a live web view.
    func handle(body: Any, frameOrigin: URL?, isMainFrame: Bool) async -> [String: Any] {
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
            var data: [String: Any] = [
                "runtimeTrust": "Unverified",
                "generationEnabled": false,
                "dispatcherMode": "read-only"
            ]
            switch runtimeDependency {
            case .shared(let service):
                let snapshot = await service.snapshot()
                data["runtimeAvailable"] = true
                data["modelLoaded"] = !snapshot.loadedModelIDs.isEmpty
                data["activeLeaseCount"] = snapshot.activeLeaseCount
            case .unavailable:
                data["runtimeAvailable"] = false
                data["modelLoaded"] = false
                data["activeLeaseCount"] = 0
            case .createForTesting:
                data["runtimeAvailable"] = false
                data["modelLoaded"] = false
                data["activeLeaseCount"] = 0
            }
            return ["id": messageID, "ok": true, "data": data]

        case "listModels":
            do {
                let catalog = try modelCatalogStore.load()
                let models: [[String: Any]] = catalog.entries.map { entry in
                    [
                        "id": entry.id,
                        "name": entry.name,
                        "contextLength": entry.contextLength,
                        "quantization": entry.quantization,
                        "estimatedMemoryMB": entry.estimatedMemoryMB,
                        "selected": entry.id == catalog.selectedModelID
                    ]
                }
                return ["id": messageID, "ok": true, "data": ["models": models]]
            } catch {
                return Self.error("catalog_unavailable", id: messageID)
            }

        default:
            // Readiness, validation, generation, and cancellation remain off
            // until they can use the exact app-scoped lease and host challenge.
            // Import/load/unload are rejected by BridgeGate without native approval.
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

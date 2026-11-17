import Foundation
import WebKit
import ApexBridge
import PocketLlamaEngine

/// Main-frame WebKit ingress. Runtime commands are accepted only when the
/// controller resolves to the exact model session already leased by Local AI.
/// The controller takes its own consumer lease from the same app-scoped pool;
/// it must resolve to the same RuntimeSession ID before any probe or generation.
@MainActor
final class WorkspaceBridgeDispatcher: NSObject, WKScriptMessageHandlerWithReply {
    static let messageHandlerName = "pocketAILab"
    private static let maximumMessageBytes = 40_960
    private static let maximumOutputBytes = 64_000

    private let trustedURL: URL
    private let runtimeDependency: LocalChatRuntimeDependency
    private let modelCatalogStore: LocalModelCatalogStore
    private let challengeStore: BridgeChallengeStore?
    private let runtimeController: RuntimeController?
    private var isActive = true
    private var lifecycleGeneration: UInt64 = 0

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

        if case .shared(let service) = runtimeDependency,
           let challengeStore = try? BridgeChallengeStore() {
            self.challengeStore = challengeStore
            self.runtimeController = try? RuntimeController(
                runtime: service.runtime,
                deviceId: "unattested-ios-device",
                runtimeIdentity: "pocket-ai-lab-native-runtime",
                challengeStore: challengeStore,
                trustedWorkspaceURL: trustedURL
            )
        } else {
            self.challengeStore = nil
            self.runtimeController = nil
        }
    }

    /// A same-origin page navigation must invalidate outstanding one-use
    /// challenges without permanently disabling the new document's bridge.
    func navigationStarted() async {
        guard isActive else { return }
        lifecycleGeneration &+= 1
        guard let challengeStore else { return }
        await challengeStore.invalidateAll()
        _ = await runtimeController?.cancelAllGenerations()
    }

    func invalidate() {
        guard isActive else { return }
        lifecycleGeneration &+= 1
        isActive = false
        guard let challengeStore, let runtimeController else { return }
        Task {
            await challengeStore.invalidateAll()
            await runtimeController.disconnect()
        }
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
        let requestGeneration = lifecycleGeneration
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
                "dispatcherMode": "read-only-until-ready"
            ]
            switch runtimeDependency {
            case .shared(let service):
                let snapshot = await service.snapshot()
                data["runtimeAvailable"] = true
                data["modelLoaded"] = !snapshot.loadedModelIDs.isEmpty
                data["activeLeaseCount"] = snapshot.activeLeaseCount
                data["activeUseCount"] = snapshot.activeUseCount
                data["activeLocalSessions"] = service.activeLeases().map { lease in
                    [
                        "modelId": lease.model.id,
                        "sessionId": lease.session.id
                    ]
                }
                if let runtimeController {
                    let reports = await runtimeController.reports()
                    let activeLocalSessionIDs = Set(service.activeLeases().map { $0.session.id })
                    data["generationEnabled"] = reports.contains {
                        $0.canGenerate && activeLocalSessionIDs.contains($0.sessionId ?? "")
                    }
                    data["dispatcherMode"] = (data["generationEnabled"] as? Bool == true)
                        ? "challenge-gated"
                        : "read-only-until-ready"
                    data["controllerSessions"] = reports.map { report in
                        [
                            "modelId": report.id,
                            "phase": report.phase,
                            "canGenerate": report.canGenerate,
                            "sharedLocalLeaseActive": activeLocalSessionIDs.contains(report.sessionId ?? ""),
                            "sessionId": report.sessionId ?? ""
                        ]
                    }
                } else {
                    data["controllerSessions"] = []
                }
            case .unavailable:
                data["runtimeAvailable"] = false
                data["modelLoaded"] = false
                data["activeLeaseCount"] = 0
                data["activeUseCount"] = 0
                data["activeLocalSessions"] = []
                data["controllerSessions"] = []
            case .createForTesting:
                data["runtimeAvailable"] = false
                data["modelLoaded"] = false
                data["activeLeaseCount"] = 0
                data["activeUseCount"] = 0
                data["activeLocalSessions"] = []
                data["controllerSessions"] = []
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

        case "checkReadiness":
            guard let requestedSession = message["sessionId"] as? String,
                  let sessionId = await ensureControllerSession(lifecycleGeneration: requestGeneration),
                  lifecycleGeneration == requestGeneration,
                  requestedSession == sessionId,
                  let runtimeController else {
                return Self.error("model_not_loaded_or_session_mismatch", id: messageID)
            }
            do {
                let report = try await runtimeController.readiness(sessionId: sessionId)
                guard isActive, lifecycleGeneration == requestGeneration else { return Self.error("bridge_unavailable", id: messageID) }
                return [
                    "id": messageID,
                    "ok": true,
                    "data": [
                        "modelId": report.id,
                        "phase": report.phase,
                        "canGenerate": report.canGenerate,
                        "sessionId": report.sessionId ?? "",
                        "fileHash": report.fileHash ?? "",
                        "runtimeVersion": report.runtimeVersion ?? "",
                        "healthCheckId": report.healthCheckId ?? "",
                        "expiresAt": report.expiresAt?.timeIntervalSince1970 ?? 0
                    ]
                ]
            } catch {
                return Self.error("readiness_failed", id: messageID, detail: String(describing: error))
            }

        case "authorizeGeneration":
            guard let requestedSession = message["sessionId"] as? String,
                  let requestId = message["requestId"] as? String,
                  let sessionId = await ensureControllerSession(),
                  requestedSession == sessionId,
                  let runtimeController,
                  let challengeStore,
                  await runtimeController.reports().contains(where: { $0.sessionId == sessionId && $0.canGenerate }),
                  isActive, lifecycleGeneration == requestGeneration else {
                return Self.error("runtime_not_ready", id: messageID)
            }
            do {
                let nonce = try await challengeStore.issue(
                    page: frameOrigin ?? trustedURL,
                    trusted: trustedURL,
                    requestId: requestId,
                    sessionId: sessionId
                )
                guard isActive, lifecycleGeneration == requestGeneration else {
                    await challengeStore.invalidateAll()
                    return Self.error("bridge_unavailable", id: messageID)
                }
                return [
                    "id": messageID,
                    "ok": true,
                    "data": [
                        "challengeNonce": nonce,
                        "expiresInSeconds": 60,
                        "requestId": requestId,
                        "sessionId": sessionId
                    ]
                ]
            } catch {
                return Self.error("challenge_issue_failed", id: messageID, detail: String(describing: error))
            }

        case "generate":
            guard let requestedSession = message["sessionId"] as? String,
                  let prompt = message["prompt"] as? String,
                  let requestId = message["requestId"] as? String,
                  let conversationRequestId = message["conversationRequestId"] as? String,
                  let attemptId = message["attemptId"] as? String,
                  let challengeNonce = message["challengeNonce"] as? String,
                  let sessionId = await ensureControllerSession(),
                  requestedSession == sessionId,
                  let frameOrigin,
                  let runtimeController else {
                return Self.error("model_not_loaded_or_session_mismatch", id: messageID)
            }
            do {
                guard isActive, lifecycleGeneration == requestGeneration else { return Self.error("bridge_unavailable", id: messageID) }
                let record = try await runtimeController.generate(
                    sessionId: sessionId,
                    prompt: prompt,
                    requestId: requestId,
                    conversationRequestId: conversationRequestId,
                    attemptId: attemptId,
                    challengeNonce: challengeNonce,
                    pageURL: frameOrigin,
                    maxTokens: message["maxTokens"] as? Int ?? 512,
                    temperature: message["temperature"] as? Double ?? 0.2,
                    maxOutputBytes: Self.maximumOutputBytes
                )
                guard isActive, lifecycleGeneration == requestGeneration else { return Self.error("bridge_unavailable", id: messageID) }
                return [
                    "id": messageID,
                    "ok": true,
                    "data": [
                        "output": record.output,
                        "requestId": record.requestId,
                        "conversationRequestId": record.conversationRequestId,
                        "attemptId": record.attemptId,
                        "modelId": record.modelId,
                        "runtimeSessionId": record.runtimeSessionId,
                        "modelFileHash": record.modelFileHash,
                        "runtimeVersion": record.runtimeVersion,
                        "generationResultHash": record.generationResultHash,
                        "generatedAt": record.generatedAt.timeIntervalSince1970,
                        "authorized": false
                    ]
                ]
            } catch {
                return Self.error("generation_failed", id: messageID, detail: String(describing: error))
            }

        case "cancelGeneration":
            guard let requestedSession = message["sessionId"] as? String,
                  let requestId = message["requestId"] as? String,
                  let sessionId = await ensureControllerSession(),
                  requestedSession == sessionId,
                  let runtimeController else {
                return Self.error("model_not_loaded_or_session_mismatch", id: messageID)
            }
            let cancelled = await runtimeController.cancelGeneration(sessionId: sessionId, requestId: requestId)
            return ["id": messageID, "ok": true, "data": ["cancelled": cancelled]]

        default:
            // Import/load/unload remain rejected by BridgeGate until a separate
            // parameter-bound native approval coordinator exists.
            return Self.error("action_not_enabled", id: messageID)
        }
    }

    /// The Director controller obtains a second consumer lease from the same
    /// app-scoped ModelPool. It is accepted only if it resolves to the exact
    /// RuntimeSession already held by Local AI; no duplicate engine load is
    /// treated as equivalent merely because the model ID matches.
    private func ensureControllerSession(lifecycleGeneration expectedGeneration: UInt64) async -> String? {
        guard isActive, lifecycleGeneration == expectedGeneration,
              case .shared(let service) = runtimeDependency,
              let runtimeController else { return nil }
        do {
            let catalog = try modelCatalogStore.load()
            guard let selectedID = catalog.selectedModelID,
                  let entry = catalog.entries.first(where: { $0.id == selectedID }) else {
                await challengeStore?.invalidateAll()
                await runtimeController.disconnect()
                return nil
            }
            let modelURL = try modelCatalogStore.resolve(entry)
            let descriptor = ModelDescriptor(
                id: entry.id,
                name: entry.name,
                path: modelURL.path,
                contextLength: entry.contextLength,
                quantization: entry.quantization
            )
            guard let localLease = service.activeLeases().first(where: {
                $0.model == descriptor && $0.session.modelId == entry.id
            }) else {
                await challengeStore?.invalidateAll()
                await runtimeController.disconnect()
                return nil
            }

            let reports = await runtimeController.reports()
            guard isActive, lifecycleGeneration == expectedGeneration else { return nil }
            if let existing = reports.first(where: {
                $0.id == entry.id && $0.fileHash == entry.sha256 &&
                $0.sessionId == localLease.session.id
            }), let sessionId = existing.sessionId {
                return sessionId
            }

            await challengeStore?.invalidateAll()
            await runtimeController.disconnect()
            guard isActive, lifecycleGeneration == expectedGeneration else { return nil }
            let report = try await runtimeController.load(
                model: descriptor,
                expectedFileHash: entry.sha256,
                estimatedMemoryMB: entry.estimatedMemoryMB
            )
            guard isActive, lifecycleGeneration == expectedGeneration else {
                if let staleSession = report.sessionId { _ = await runtimeController.unload(sessionId: staleSession) }
                return nil
            }
            guard let sessionId = report.sessionId,
                  sessionId == localLease.session.id else {
                if let mismatchedSession = report.sessionId {
                    _ = await runtimeController.unload(sessionId: mismatchedSession)
                }
                return nil
            }
            return sessionId
        } catch {
            await runtimeController.disconnect()
            return nil
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

    private static func error(_ code: String, id: String = "", detail: String? = nil) -> [String: Any] {
        var result: [String: Any] = ["id": id, "ok": false, "error": code]
        if let detail {
            result["detail"] = String(detail.prefix(256))
        }
        return result
    }
}

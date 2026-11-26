import Foundation
import CryptoKit

enum CloudAnalysisRemoteOutcome: String, Codable, Equatable, Sendable {
    case notStarted = "not_started"
    case unknown
}

/// Transport bookkeeping only. These values are not execution authorization or evidence.
enum CloudAnalysisError: Error, LocalizedError, Equatable, Sendable {
    case invalidConfiguration
    case invalidRequest
    case consentRequired
    case consentExpired
    case invalidResponse
    case responseMismatch
    case responseTooLarge
    case redirectRejected
    case transportFailed
    case cancelled
    case gateway(code: String, outcome: CloudAnalysisRemoteOutcome)

    static let notStartedCodes: Set<String> = [
        "disabled", "unauthenticated", "invalid_request", "consent_required",
        "consent_expired", "profile_mismatch", "input_mismatch", "payload_too_large",
        "busy", "capacity", "unsupported_media_type", "method_not_allowed", "not_found"
    ]
    static let unknownCodes: Set<String> = [
        "duplicate_attempt", "upstream_timeout", "upstream_failed", "invalid_response",
        "cancelled", "internal_error"
    ]

    var remoteOutcome: CloudAnalysisRemoteOutcome {
        switch self {
        case .invalidConfiguration, .invalidRequest, .consentRequired, .consentExpired:
            return .notStarted
        case let .gateway(code, outcome):
            return outcome == .notStarted && Self.notStartedCodes.contains(code) ? .notStarted : .unknown
        default:
            return .unknown
        }
    }

    var errorDescription: String? {
        switch self {
        case .invalidConfiguration:
            return "Configure an HTTPS gateway, exact profile and model, and an application access token."
        case .invalidRequest:
            return "The cloud analysis request is invalid or exceeds its limits. Nothing was submitted."
        case .consentRequired:
            return "Approve the displayed input for this cloud analysis before submitting it."
        case .consentExpired:
            return "Cloud sharing consent expired. Review the input again before submitting."
        case .invalidResponse, .responseMismatch:
            return "The gateway result could not be validated. The remote outcome is unknown."
        case .responseTooLarge:
            return "The gateway response exceeded its size limit. The remote outcome is unknown."
        case .redirectRejected:
            return "The gateway attempted a redirect, which was refused. The remote outcome is unknown."
        case .transportFailed:
            return "The cloud connection did not complete. The remote outcome is unknown; the app did not retry this attempt."
        case .cancelled:
            return "Waiting for the cloud result was cancelled. Remote execution may have continued."
        case let .gateway(code, _):
            let knownCode = Self.notStartedCodes.contains(code) || Self.unknownCodes.contains(code)
                ? code : "invalid_response"
            return remoteOutcome == .notStarted
                ? "The gateway rejected this request before inference (\(knownCode))."
                : "The gateway reported \(knownCode). The remote outcome is unknown; the app did not retry this attempt."
        }
    }
}

private enum CloudAnalysisLimits {
    static let maximumInputBytes = 4_000
    static let maximumOutputBytes = 8_000
    static let maximumRequestBytes = 32 * 1_024
    static let maximumResponseBytes = 64 * 1_024
    static let consentLifetimeMilliseconds = 300_000
    static let maximumSafeInteger = 9_007_199_254_740_991

    static func identifier(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        func alphanumeric(_ byte: UInt8) -> Bool {
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
        }
        guard (1...128).contains(bytes.count), let first = bytes.first, alphanumeric(first) else { return false }
        return bytes.dropFirst().allSatisfy { alphanumeric($0) || [46, 95, 58, 45].contains($0) }
    }

    static func milliseconds(_ date: Date) throws -> Int {
        let value = (date.timeIntervalSince1970 * 1_000).rounded(.down)
        guard value.isFinite, value >= 0,
              value <= Double(maximumSafeInteger - consentLifetimeMilliseconds) else {
            throw CloudAnalysisError.invalidRequest
        }
        return Int(value)
    }

    static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func hasExactKeys(_ object: [String: Any], _ keys: Set<String>) -> Bool {
        Set(object.keys) == keys
    }
}

/// Session-only connection settings. Deliberately not Codable; diagnostic strings redact the token.
struct CloudAnalysisConfiguration: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
    let origin: URL
    let profileID: String
    let requestedModel: String
    fileprivate let applicationToken: String

    init(origin: URL, profileID: String, requestedModel: String, applicationToken: String,
         allowLoopbackForTests: Bool = false) throws {
        guard var parts = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              origin.absoluteString.utf8.count <= 2_048,
              let scheme = parts.scheme?.lowercased(),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.percentEncodedPath.isEmpty || parts.percentEncodedPath == "/",
              parts.port == nil || (1...65_535).contains(parts.port!),
              CloudAnalysisLimits.identifier(profileID), CloudAnalysisLimits.identifier(requestedModel),
              (32...4_096).contains(applicationToken.utf8.count),
              applicationToken.utf8.allSatisfy({ (33...126).contains($0) }) else {
            throw CloudAnalysisError.invalidConfiguration
        }
        let normalizedHost = host.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased()
        let fixtureLoopback = allowLoopbackForTests && scheme == "http" &&
            ["127.0.0.1", "::1", "localhost"].contains(normalizedHost)
        guard scheme == "https" || fixtureLoopback else { throw CloudAnalysisError.invalidConfiguration }
        parts.scheme = scheme
        parts.path = ""
        guard let canonical = parts.url else { throw CloudAnalysisError.invalidConfiguration }
        self.origin = canonical
        self.profileID = profileID
        self.requestedModel = requestedModel
        self.applicationToken = applicationToken
    }

    var endpoint: URL { origin.appendingPathComponent("v1/cloud-analysis") }
    var description: String { "CloudAnalysisConfiguration(origin: \(origin.absoluteString), profile: \(profileID), model: \(requestedModel), token: <redacted>)" }
    var debugDescription: String { description }
}

struct CloudAnalysisRequest: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let taskID: String
    let attemptID: String
    let profileID: String
    let requestedModel: String
    let inputText: String
    let inputSHA256: String
    let consentExpiresAt: Int
    let remoteConsent: Bool
    let maxOutputTokens: Int

    static func prepare(taskID: String, inputText: String, configuration: CloudAnalysisConfiguration,
                        consent: Bool, now: Date = Date(), attemptID: UUID = UUID(),
                        maxOutputTokens: Int = 512) throws -> CloudAnalysisRequest {
        guard consent else { throw CloudAnalysisError.consentRequired }
        let timestamp = try CloudAnalysisLimits.milliseconds(now)
        let request = CloudAnalysisRequest(
            schemaVersion: 1, taskID: taskID, attemptID: attemptID.uuidString.lowercased(),
            profileID: configuration.profileID, requestedModel: configuration.requestedModel,
            inputText: inputText, inputSHA256: CloudAnalysisLimits.digest(inputText),
            consentExpiresAt: timestamp + CloudAnalysisLimits.consentLifetimeMilliseconds,
            remoteConsent: true, maxOutputTokens: maxOutputTokens
        )
        try request.validate(configuration: configuration, now: now)
        return request
    }

    func validate(configuration: CloudAnalysisConfiguration, now: Date = Date()) throws {
        guard remoteConsent else { throw CloudAnalysisError.consentRequired }
        let timestamp = try CloudAnalysisLimits.milliseconds(now)
        guard consentExpiresAt > timestamp else { throw CloudAnalysisError.consentExpired }
        guard schemaVersion == 1,
              CloudAnalysisLimits.identifier(taskID),
              UUID(uuidString: attemptID)?.uuidString.lowercased() == attemptID,
              CloudAnalysisLimits.identifier(profileID), CloudAnalysisLimits.identifier(requestedModel),
              profileID == configuration.profileID, requestedModel == configuration.requestedModel,
              !inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              inputText.utf8.count <= CloudAnalysisLimits.maximumInputBytes,
              inputSHA256 == CloudAnalysisLimits.digest(inputText),
              consentExpiresAt <= timestamp + CloudAnalysisLimits.consentLifetimeMilliseconds,
              (1...512).contains(maxOutputTokens) else {
            throw CloudAnalysisError.invalidRequest
        }
    }
}

struct CloudAnalysisUsage: Codable, Equatable, Sendable {
    let promptTokens: Int
    let completionTokens: Int
    let totalTokens: Int
}

struct CloudAnalysisResult: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let taskID: String
    let attemptID: String
    let profileID: String
    let requestedModel: String
    let inputSHA256: String
    let execution: String
    let providerID: String
    let actualModel: String
    let providerResponseID: String
    let text: String
    let usage: CloudAnalysisUsage
    let finishReason: String
    let authorized: Bool

    func validate(for request: CloudAnalysisRequest) throws {
        guard taskID == request.taskID, attemptID == request.attemptID,
              profileID == request.profileID, requestedModel == request.requestedModel,
              inputSHA256 == request.inputSHA256 else { throw CloudAnalysisError.responseMismatch }
        guard (1...512).contains(request.maxOutputTokens),
              schemaVersion == 1, execution == "cloud", providerID == "deepseek", !authorized,
              CloudAnalysisLimits.identifier(actualModel), CloudAnalysisLimits.identifier(providerResponseID),
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              text.utf8.count <= CloudAnalysisLimits.maximumOutputBytes,
              finishReason == "stop", usage.promptTokens >= 0,
              (0...request.maxOutputTokens).contains(usage.completionTokens),
              usage.totalTokens >= 0, usage.totalTokens <= CloudAnalysisLimits.maximumSafeInteger,
              usage.promptTokens <= CloudAnalysisLimits.maximumSafeInteger - usage.completionTokens,
              usage.promptTokens + usage.completionTokens == usage.totalTokens else {
            throw CloudAnalysisError.invalidResponse
        }
    }
}

protocol CloudAnalysisSending: Sendable {
    func send(request: CloudAnalysisRequest, configuration: CloudAnalysisConfiguration) async throws -> CloudAnalysisResult
}

struct CloudAnalysisHTTPResponse: Sendable {
    let statusCode: Int
    let url: URL
    let mediaType: String?
    let body: Data
}

protocol CloudAnalysisHTTPTransporting: Sendable {
    func send(_ request: URLRequest) async throws -> CloudAnalysisHTTPResponse
}

/// One bounded foreground request. This client has no queue, retry, model fallback or action API.
struct CloudAnalysisClient: CloudAnalysisSending {
    private let transport: any CloudAnalysisHTTPTransporting
    private let now: @Sendable () -> Date

    init(now: @escaping @Sendable () -> Date = Date.init) {
        transport = URLSessionCloudAnalysisTransport()
        self.now = now
    }

    init(transport: any CloudAnalysisHTTPTransporting, now: @escaping @Sendable () -> Date = Date.init) {
        self.transport = transport
        self.now = now
    }

    func send(request: CloudAnalysisRequest, configuration: CloudAnalysisConfiguration) async throws -> CloudAnalysisResult {
        try request.validate(configuration: configuration, now: now())
        guard !Task.isCancelled else { throw CloudAnalysisError.cancelled }
        let payload: Data
        do { payload = try JSONEncoder().encode(request) }
        catch { throw CloudAnalysisError.invalidRequest }
        guard payload.count <= CloudAnalysisLimits.maximumRequestBytes else { throw CloudAnalysisError.invalidRequest }
        var outgoing = URLRequest(url: configuration.endpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 45)
        outgoing.httpMethod = "POST"
        outgoing.setValue("application/json", forHTTPHeaderField: "Content-Type")
        outgoing.setValue("application/json", forHTTPHeaderField: "Accept")
        outgoing.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        outgoing.setValue("Bearer " + configuration.applicationToken, forHTTPHeaderField: "Authorization")
        outgoing.httpBody = payload
        // A prepared request can outlive the UI action; check again at the last admission point.
        try request.validate(configuration: configuration, now: now())
        guard !Task.isCancelled else { throw CloudAnalysisError.cancelled }
        let response: CloudAnalysisHTTPResponse
        do { response = try await transport.send(outgoing) }
        catch let error as CloudAnalysisError {
            switch error {
            case .responseTooLarge, .redirectRejected, .invalidResponse, .cancelled: throw error
            default: throw CloudAnalysisError.transportFailed
            }
        } catch {
            throw Task.isCancelled ? CloudAnalysisError.cancelled : CloudAnalysisError.transportFailed
        }
        guard !Task.isCancelled else { throw CloudAnalysisError.cancelled }
        guard response.body.count <= CloudAnalysisLimits.maximumResponseBytes else { throw CloudAnalysisError.responseTooLarge }
        guard response.url == configuration.endpoint,
              response.mediaType?.lowercased() == "application/json",
              let object = try? JSONSerialization.jsonObject(with: response.body) as? [String: Any] else {
            throw CloudAnalysisError.invalidResponse
        }
        if response.statusCode != 200 {
            throw Self.gatewayError(object)
        }
        let resultKeys: Set<String> = [
            "schemaVersion", "taskID", "attemptID", "profileID", "requestedModel", "inputSHA256",
            "execution", "providerID", "actualModel", "providerResponseID", "text", "usage",
            "finishReason", "authorized"
        ]
        guard CloudAnalysisLimits.hasExactKeys(object, resultKeys),
              let usage = object["usage"] as? [String: Any],
              CloudAnalysisLimits.hasExactKeys(usage, ["promptTokens", "completionTokens", "totalTokens"]),
              let result = try? JSONDecoder().decode(CloudAnalysisResult.self, from: response.body) else {
            throw CloudAnalysisError.invalidResponse
        }
        try result.validate(for: request)
        return result
    }

    private static func gatewayError(_ object: [String: Any]) -> CloudAnalysisError {
        struct Failure: Decodable {
            struct Detail: Decodable { let code: String; let remoteOutcome: CloudAnalysisRemoteOutcome }
            let schemaVersion: Int
            let error: Detail
        }
        guard CloudAnalysisLimits.hasExactKeys(object, ["schemaVersion", "error"]),
              let detail = object["error"] as? [String: Any],
              CloudAnalysisLimits.hasExactKeys(detail, ["code", "remoteOutcome"]),
              let bytes = try? JSONSerialization.data(withJSONObject: object),
              let decoded = try? JSONDecoder().decode(Failure.self, from: bytes), decoded.schemaVersion == 1,
              CloudAnalysisError.notStartedCodes.contains(decoded.error.code) ||
                CloudAnalysisError.unknownCodes.contains(decoded.error.code) else {
            return .invalidResponse
        }
        let outcome: CloudAnalysisRemoteOutcome = decoded.error.remoteOutcome == .notStarted &&
            CloudAnalysisError.notStartedCodes.contains(decoded.error.code) ? .notStarted : .unknown
        return .gateway(code: decoded.error.code, outcome: outcome)
    }
}

/// The delegate accumulates at most 64 KiB. A single lock protects completion,
/// including cancellation before registration and late URLSession callbacks.
struct URLSessionCloudAnalysisTransport: CloudAnalysisHTTPTransporting {
    private let protocolClasses: [AnyClass]?

    init(protocolClasses: [AnyClass]? = nil) { self.protocolClasses = protocolClasses }

    func send(_ request: URLRequest) async throws -> CloudAnalysisHTTPResponse {
        let operation = CloudAnalysisHTTPOperation(protocolClasses: protocolClasses)
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                operation.start(request, continuation: continuation)
            }
        } onCancel: {
            operation.cancel()
        }
    }
}

private final class CloudAnalysisHTTPOperation: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let protocolClasses: [AnyClass]?
    private var continuation: CheckedContinuation<CloudAnalysisHTTPResponse, Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var cancelled = false
    private var finished = false
    private var response: HTTPURLResponse?
    private var body = Data()

    init(protocolClasses: [AnyClass]?) { self.protocolClasses = protocolClasses }

    func start(_ request: URLRequest, continuation: CheckedContinuation<CloudAnalysisHTTPResponse, Error>) {
        lock.lock()
        if cancelled {
            finished = true
            lock.unlock()
            continuation.resume(throwing: CloudAnalysisError.cancelled)
            return
        }
        self.continuation = continuation
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 45
        configuration.timeoutIntervalForResource = 45
        configuration.waitsForConnectivity = false
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.protocolClasses = protocolClasses
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        self.session = session
        let task = session.dataTask(with: request)
        self.task = task
        // Cancellation cannot pass between registering this task and resuming it.
        task.resume()
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        cancelled = true
        let registered = continuation != nil
        lock.unlock()
        if registered { finish(.failure(CloudAnalysisError.cancelled)) }
    }

    private func finish(_ result: Result<CloudAnalysisHTTPResponse, Error>) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        finished = true
        let continuation = self.continuation
        let session = self.session
        self.continuation = nil
        self.task = nil
        self.session = nil
        body.removeAll(keepingCapacity: false)
        lock.unlock()
        session?.invalidateAndCancel()
        continuation?.resume(with: result)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(.failure(CloudAnalysisError.redirectRejected))
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse,
              http.expectedContentLength <= Int64(CloudAnalysisLimits.maximumResponseBytes) else {
            completionHandler(.cancel)
            finish(.failure(response.expectedContentLength > Int64(CloudAnalysisLimits.maximumResponseBytes)
                ? CloudAnalysisError.responseTooLarge : CloudAnalysisError.invalidResponse))
            return
        }
        lock.lock()
        let allowed = !finished && self.response == nil
        if allowed { self.response = http }
        lock.unlock()
        completionHandler(allowed ? .allow : .cancel)
        if !allowed { finish(.failure(CloudAnalysisError.invalidResponse)) }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        let oversized = data.count > CloudAnalysisLimits.maximumResponseBytes - body.count
        if !oversized { body.append(data) }
        lock.unlock()
        if oversized { finish(.failure(CloudAnalysisError.responseTooLarge)) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        guard !finished else { lock.unlock(); return }
        let response = self.response
        let body = self.body
        let cancelled = self.cancelled
        lock.unlock()
        if cancelled { finish(.failure(CloudAnalysisError.cancelled)); return }
        if error != nil { finish(.failure(CloudAnalysisError.transportFailed)); return }
        guard let response, let url = response.url else {
            finish(.failure(CloudAnalysisError.invalidResponse)); return
        }
        finish(.success(CloudAnalysisHTTPResponse(
            statusCode: response.statusCode, url: url, mediaType: response.mimeType, body: body
        )))
    }
}

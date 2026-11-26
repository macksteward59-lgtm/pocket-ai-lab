import Foundation
import CryptoKit
import Darwin

private struct SmokeFailure: Error, CustomStringConvertible {
    let description: String
}

private func require(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw SmokeFailure(description: message) }
}

private func expectError(_ expected: CloudAnalysisError, _ operation: () throws -> Void) throws {
    do { try operation(); throw SmokeFailure(description: "Expected \(expected)") }
    catch let error as CloudAnalysisError { try require(error == expected, "Unexpected cloud error: \(error)") }
}

private func expectAsyncError(_ expected: CloudAnalysisError,
                              _ operation: () async throws -> Void) async throws {
    do { try await operation(); throw SmokeFailure(description: "Expected \(expected)") }
    catch let error as CloudAnalysisError { try require(error == expected, "Unexpected cloud error: \(error)") }
}

private final class FixtureState: @unchecked Sendable {
    private let lock = NSLock()
    private var handler: (@Sendable (FixtureURLProtocol) -> Void)?
    private var requests: [URLRequest] = []

    func install(_ handler: @escaping @Sendable (FixtureURLProtocol) -> Void) {
        lock.lock(); defer { lock.unlock() }
        self.handler = handler
        requests = []
    }

    func start(_ instance: FixtureURLProtocol) {
        lock.lock()
        requests.append(instance.request)
        let handler = self.handler
        lock.unlock()
        handler?(instance)
    }

    func captured() -> [URLRequest] {
        lock.lock(); defer { lock.unlock() }
        return requests
    }
}

private final class FixtureURLProtocol: URLProtocol, @unchecked Sendable {
    static let state = FixtureState()
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.state.start(self) }
    override func stopLoading() {}

    func respond(status: Int = 200, headers: [String: String] = ["Content-Type": "application/json"],
                 chunks: [Data]) {
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in chunks { client?.urlProtocol(self, didLoad: chunk) }
        client?.urlProtocolDidFinishLoading(self)
    }
}

private actor Arrival {
    private var arrived = false
    private var waiter: CheckedContinuation<Void, Never>?
    func signal() { arrived = true; waiter?.resume(); waiter = nil }
    func wait() async {
        if arrived { return }
        await withCheckedContinuation { waiter = $0 }
    }
}

@MainActor
private final class ClientSmokeSuite {
    private(set) var count = 0
    let now = Date(timeIntervalSince1970: 1_795_210_000)
    let token = "fixture-app-token-at-least-32-characters"

    func run(_ name: String, _ operation: () async throws -> Void) async throws {
        try await operation()
        count += 1
        print("POCKET_CLOUD_CLIENT_TEST \(name) PASS")
    }

    func configuration(origin: String = "https://gateway.example.invalid") throws -> CloudAnalysisConfiguration {
        try CloudAnalysisConfiguration(origin: URL(string: origin)!, profileID: "pocket-analysis-v1",
            requestedModel: "deepseek-flash", applicationToken: token)
    }

    func request(configuration: CloudAnalysisConfiguration) throws -> CloudAnalysisRequest {
        try CloudAnalysisRequest.prepare(taskID: "fixture-task", inputText: "Private selected input: café 🌲",
            configuration: configuration, consent: true, now: now,
            attemptID: UUID(uuidString: "00112233-4455-6677-8899-AABBCCDDEEFF")!)
    }

    func response(_ request: CloudAnalysisRequest) -> [String: Any] {
        ["schemaVersion": 1, "taskID": request.taskID, "attemptID": request.attemptID,
         "profileID": request.profileID, "requestedModel": request.requestedModel,
         "inputSHA256": request.inputSHA256, "execution": "cloud", "providerID": "deepseek",
         "actualModel": "fixture-deepseek-flash", "providerResponseID": "fixture-response-1",
         "text": "Fixture cloud analysis, not a live model result.",
         "usage": ["promptTokens": 5, "completionTokens": 7, "totalTokens": 12],
         "finishReason": "stop", "authorized": false]
    }

    func client() -> CloudAnalysisClient {
        let timestamp = now
        return CloudAnalysisClient(transport: URLSessionCloudAnalysisTransport(protocolClasses: [FixtureURLProtocol.self]),
                                   now: { timestamp })
    }

    func install(_ object: [String: Any], status: Int = 200) throws {
        let data = try JSONSerialization.data(withJSONObject: object)
        FixtureURLProtocol.state.install { $0.respond(status: status, chunks: [data]) }
    }

    func all() async throws {
        let config = try configuration()
        let prepared = try request(configuration: config)

        try await run("configuration-fails-closed") {
            for origin in ["http://gateway.example.invalid", "http://127.0.0.1:1234",
                           "https://user:password@gateway.example.invalid", "https://gateway.example.invalid/path",
                           "https://gateway.example.invalid?", "https://gateway.example.invalid#",
                           "https://gateway.example.invalid:0"] {
                try expectError(.invalidConfiguration) { _ = try self.configuration(origin: origin) }
            }
            try expectError(.invalidConfiguration) {
                _ = try CloudAnalysisConfiguration(origin: config.origin, profileID: "bad profile",
                    requestedModel: "deepseek-flash", applicationToken: self.token)
            }
            try expectError(.invalidConfiguration) {
                _ = try CloudAnalysisConfiguration(origin: config.origin, profileID: config.profileID,
                    requestedModel: config.requestedModel, applicationToken: self.token + "\r\nInjected: x")
            }
            try require(!String(describing: config).contains(self.token), "Configuration description leaked token")
            try require(!String(reflecting: config).contains(self.token), "Configuration debug string leaked token")
        }

        try await run("request-exact-bytes-and-one-use-snapshot") {
            try require(prepared.inputText == "Private selected input: café 🌲", "Input text changed")
            try require(prepared.attemptID == "00112233-4455-6677-8899-aabbccddeeff", "UUID was not canonical")
            let digest = SHA256.hash(data: Data(prepared.inputText.utf8)).map { String(format: "%02x", $0) }.joined()
            try require(prepared.inputSHA256 == digest, "Digest did not match UTF8 input")
            let data = try JSONEncoder().encode(prepared)
            let object = try JSONSerialization.jsonObject(with: data) as! [String: Any]
            try require(Set(object.keys) == ["schemaVersion", "taskID", "attemptID", "profileID", "requestedModel",
                "inputText", "inputSHA256", "consentExpiresAt", "remoteConsent", "maxOutputTokens"], "Unexpected outbound fields")
            try require(!String(decoding: data, as: UTF8.self).contains(self.token), "Token appeared in payload")
        }

        try await run("consent-time-and-input-preflight") {
            FixtureURLProtocol.state.install { _ in }
            try expectError(.consentRequired) {
                _ = try CloudAnalysisRequest.prepare(taskID: "task", inputText: "text", configuration: config, consent: false, now: self.now)
            }
            try expectError(.invalidRequest) {
                _ = try CloudAnalysisRequest.prepare(taskID: "task", inputText: String(repeating: "🌲", count: 1_001),
                    configuration: config, consent: true, now: self.now)
            }
            for timestamp in [Double.nan, Double.infinity, -1, 1e18] {
                try expectError(.invalidRequest) {
                    _ = try CloudAnalysisRequest.prepare(taskID: "task", inputText: "text", configuration: config,
                        consent: true, now: Date(timeIntervalSince1970: timestamp))
                }
            }
            let expiration = Date(timeIntervalSince1970: Double(prepared.consentExpiresAt) / 1_000)
            let expiredClient = CloudAnalysisClient(transport: URLSessionCloudAnalysisTransport(protocolClasses: [FixtureURLProtocol.self]),
                                                    now: { expiration })
            try await expectAsyncError(.consentExpired) { _ = try await expiredClient.send(request: prepared, configuration: config) }
            try require(FixtureURLProtocol.state.captured().isEmpty, "Preflight rejection reached transport")
        }

        try await run("decoded-request-is-revalidated") {
            FixtureURLProtocol.state.install { _ in }
            let original = try JSONSerialization.jsonObject(with: JSONEncoder().encode(prepared)) as! [String: Any]
            let changes: [[String: Any]] = [["taskID": "task\n"], ["profileID": "pocket-analysis-v1\r"],
                                           ["attemptID": prepared.attemptID + "\n"], ["attemptID": prepared.attemptID.uppercased()],
                                           ["inputSHA256": prepared.inputSHA256 + "\n"], ["maxOutputTokens": -1],
                                           ["schemaVersion": 2], ["consentExpiresAt": prepared.consentExpiresAt + 1]]
            for change in changes {
                var object = original
                for (key, value) in change { object[key] = value }
                let request = try JSONDecoder().decode(CloudAnalysisRequest.self, from: JSONSerialization.data(withJSONObject: object))
                try await expectAsyncError(.invalidRequest) { _ = try await self.client().send(request: request, configuration: config) }
            }
            var negative = original
            negative["maxOutputTokens"] = -1
            let badRequest = try JSONDecoder().decode(CloudAnalysisRequest.self, from: JSONSerialization.data(withJSONObject: negative))
            let result = try JSONDecoder().decode(CloudAnalysisResult.self, from: JSONSerialization.data(withJSONObject: self.response(prepared)))
            try expectError(.invalidResponse) { try result.validate(for: badRequest) }
            try require(FixtureURLProtocol.state.captured().isEmpty, "Malformed decoded request reached transport")
        }

        try await run("successful-urlsession-request") {
            try self.install(self.response(prepared))
            let result = try await self.client().send(request: prepared, configuration: config)
            try result.validate(for: prepared)
            let captured = FixtureURLProtocol.state.captured()
            try require(captured.count == 1, "Expected exactly one request")
            try require(captured[0].url == config.endpoint && captured[0].httpMethod == "POST", "Wrong route/method")
            try require(captured[0].value(forHTTPHeaderField: "Authorization") == "Bearer " + self.token, "Missing application credential")
            try require(captured[0].value(forHTTPHeaderField: "Cookie") == nil, "Cookie unexpectedly sent")
            try require(result.execution == "cloud" && !result.authorized, "Result misrepresented execution/authority")
        }

        try await run("response-bindings-reject-mismatch") {
            for field in ["taskID", "attemptID", "profileID", "requestedModel", "inputSHA256"] {
                var object = self.response(prepared)
                object[field] = "different"
                try self.install(object)
                try await expectAsyncError(.responseMismatch) { _ = try await self.client().send(request: prepared, configuration: config) }
                try require(FixtureURLProtocol.state.captured().count == 1, "Invalid result was retried")
            }
        }

        try await run("response-contract-and-usage-rejection") {
            let mutations: [[String: Any]] = [
                ["authorized": true], ["finishReason": "length"], ["execution": "local"],
                ["providerID": "other"], ["actualModel": "bad model"], ["providerResponseID": ""],
                ["text": String(repeating: "🌲", count: 2_001)], ["text": "   "], ["extra": "hidden"],
                ["usage": ["promptTokens": 5, "completionTokens": 7, "totalTokens": 13]],
                ["usage": ["promptTokens": 5, "completionTokens": 513, "totalTokens": 518]],
                ["usage": ["promptTokens": -1, "completionTokens": 7, "totalTokens": 6]],
                ["usage": ["promptTokens": 5, "completionTokens": 7, "totalTokens": 12, "extra": 1]]
            ]
            for mutation in mutations {
                var object = self.response(prepared)
                for (key, value) in mutation { object[key] = value }
                try self.install(object)
                try await expectAsyncError(.invalidResponse) { _ = try await self.client().send(request: prepared, configuration: config) }
            }
        }

        try await run("gateway-error-outcomes-allowlisted") {
            try self.install(["schemaVersion": 1, "error": ["code": "unauthenticated", "remoteOutcome": "not_started"]], status: 401)
            try await expectAsyncError(.gateway(code: "unauthenticated", outcome: .notStarted)) {
                _ = try await self.client().send(request: prepared, configuration: config)
            }
            try self.install(["schemaVersion": 1, "error": ["code": "duplicate_attempt", "remoteOutcome": "not_started"]], status: 409)
            try await expectAsyncError(.gateway(code: "duplicate_attempt", outcome: .unknown)) {
                _ = try await self.client().send(request: prepared, configuration: config)
            }
            try self.install(["schemaVersion": 1, "error": ["code": "invented", "remoteOutcome": "not_started"]], status: 400)
            try await expectAsyncError(.invalidResponse) { _ = try await self.client().send(request: prepared, configuration: config) }
            try require(CloudAnalysisError.gateway(code: "upstream_timeout", outcome: .notStarted).remoteOutcome == .unknown,
                        "Constructed error bypassed outcome allowlist")
        }

        try await run("incremental-response-cap") {
            FixtureURLProtocol.state.install { instance in
                instance.respond(chunks: [Data(repeating: 65, count: 32_768), Data(repeating: 66, count: 32_768), Data([67])])
            }
            try await expectAsyncError(.responseTooLarge) { _ = try await self.client().send(request: prepared, configuration: config) }
            FixtureURLProtocol.state.install { instance in
                instance.respond(headers: ["Content-Type": "application/json", "Content-Length": "65537"], chunks: [])
            }
            try await expectAsyncError(.responseTooLarge) { _ = try await self.client().send(request: prepared, configuration: config) }
        }

        try await run("redirect-refused") {
            FixtureURLProtocol.state.install { instance in
                let target = URL(string: "https://other.example.invalid/v1/cloud-analysis")!
                let response = HTTPURLResponse(url: instance.request.url!, statusCode: 307, httpVersion: "HTTP/1.1",
                                               headerFields: ["Location": target.absoluteString])!
                instance.client?.urlProtocol(instance, wasRedirectedTo: URLRequest(url: target), redirectResponse: response)
            }
            try await expectAsyncError(.redirectRejected) { _ = try await self.client().send(request: prepared, configuration: config) }
            try require(FixtureURLProtocol.state.captured().count == 1, "Redirect target was contacted")
        }

        try await run("timeout-error-redacted-and-not-retried") {
            let privateToken = self.token
            FixtureURLProtocol.state.install { instance in
                instance.client?.urlProtocol(instance, didFailWithError: NSError(domain: NSURLErrorDomain,
                    code: NSURLErrorTimedOut, userInfo: [NSLocalizedDescriptionKey: privateToken]))
            }
            try await expectAsyncError(.transportFailed) { _ = try await self.client().send(request: prepared, configuration: config) }
            try require(FixtureURLProtocol.state.captured().count == 1, "Timed-out attempt was retried")
            try require(!CloudAnalysisError.transportFailed.localizedDescription.contains(self.token), "Raw transport error leaked")
        }

        try await run("cancel-during-request-settles-once") {
            let arrival = Arrival()
            FixtureURLProtocol.state.install { _ in Task { await arrival.signal() } }
            let client = self.client()
            let requestTask = Task {
                do { return try await client.send(request: prepared, configuration: config) }
                catch { await arrival.signal(); throw error }
            }
            await arrival.wait()
            requestTask.cancel()
            try await expectAsyncError(.cancelled) { _ = try await requestTask.value }
            try require(FixtureURLProtocol.state.captured().count == 1, "Cancelled attempt was retried")
        }

        try await run("pre-cancelled-request-does-not-dispatch") {
            FixtureURLProtocol.state.install { _ in }
            let client = self.client()
            let requestTask = Task {
                withUnsafeCurrentTask { $0?.cancel() }
                return try await client.send(request: prepared, configuration: config)
            }
            try await expectAsyncError(.cancelled) { _ = try await requestTask.value }
            try require(FixtureURLProtocol.state.captured().isEmpty, "Pre-cancelled request reached transport")
        }

        try await run("production-gateway-http-fixture-and-replay") {
            guard let value = ProcessInfo.processInfo.environment["CLOUD_ANALYSIS_FIXTURE_ORIGIN"],
                  let origin = URL(string: value) else {
                throw SmokeFailure(description: "CLOUD_ANALYSIS_FIXTURE_ORIGIN is required; fixture integration must not be skipped")
            }
            let config = try CloudAnalysisConfiguration(origin: origin, profileID: "pocket-analysis-v1",
                requestedModel: "deepseek-flash", applicationToken: self.token, allowLoopbackForTests: true)
            let request = try CloudAnalysisRequest.prepare(taskID: "fixture-native-task",
                inputText: "Explain why a cloud result must retain its model identity.",
                configuration: config, consent: true)
            let client = CloudAnalysisClient()
            let result = try await client.send(request: request, configuration: config)
            try result.validate(for: request)
            try require(result.actualModel == "fixture-deepseek-flash", "Unexpected fixture model")
            try await expectAsyncError(.gateway(code: "duplicate_attempt", outcome: .unknown)) {
                _ = try await client.send(request: request, configuration: config)
            }
        }
    }
}

@main
private struct CloudAnalysisSmoke {
    @MainActor static func main() async {
        do {
            let suite = ClientSmokeSuite()
            try await suite.all()
            print("POCKET_CLOUD_CLIENT_SUMMARY checks=\(suite.count) failures=0 fixture=production-gateway-injected-upstream")
        } catch {
            fputs("POCKET_CLOUD_CLIENT_FAILURE \(error)\n", stderr)
            exit(1)
        }
    }
}

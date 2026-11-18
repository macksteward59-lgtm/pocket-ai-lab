import XCTest
import CryptoKit
@testable import PocketLlamaEngine

final class LlamaEngineTests: XCTestCase {
    func testPlaceholderLoadThrowsAndDoesNotReturnASession() async {
        let engine = PlaceholderLlamaEngine()
        do {
            _ = try await engine.load(model: sampleModel(path: "/tmp/unused.gguf"))
            XCTFail("load returned a session")
        } catch LlamaEngineError.backendUnavailable {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testPlaceholderGenerateThrowsBeforeCreatingAStream() async {
        let engine = PlaceholderLlamaEngine()
        let session = RuntimeSession(id: "not-loaded", modelId: "none")
        do {
            _ = try await engine.generate(session: session, request: sampleRequest())
            XCTFail("generate returned a stream")
        } catch LlamaEngineError.backendUnavailable {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testForcedMetalUnavailableDoesNotCreateASession() async {
        let engine = LlamaCppMetalBackend(requireMetal: true, treatMetalAsUnavailable: true)
        do {
            _ = try await engine.load(model: sampleModel(path: "/tmp/does-not-need-to-exist.gguf"))
            XCTFail("load returned a session")
        } catch LlamaEngineError.backendUnavailable {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testProbeIsLinkedAndPrintsWhatThisProcessCanSee() {
        let probe = LlamaCppMetalBackend.probe()
        XCTAssertTrue(probe.linked)
        XCTAssertFalse(probe.pinCommit.isEmpty)
        XCTAssertEqual(probe.pinTag, "b12233")
        print("POCKET_LLAMA_PROBE linked=\(probe.linked) metalRegistered=\(probe.metalBackendRegistered) metalUsable=\(probe.metalDeviceUsable) gpus=\(probe.gpuDeviceCount) tag=\(probe.pinTag) commit=\(probe.pinCommit) version=\(probe.version) desc=\(probe.metalDeviceDescription) info=\(probe.systemInfo)")
    }

    func testRequireMetalFailsClosedWhenThisProcessHasNoMetalDevice() async throws {
        let probe = LlamaCppMetalBackend.probe()
        guard !probe.metalDeviceUsable else {
            throw XCTSkip("This process initialized Metal. Unavailable-device behavior is covered by the forced failure test.")
        }
        let engine = LlamaCppMetalBackend(requireMetal: true)
        do {
            _ = try await engine.load(model: sampleModel(path: "/tmp/ignored-because-metal-is-unavailable.gguf"))
            XCTFail("load returned a session")
        } catch LlamaEngineError.backendUnavailable {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testMissingModelDoesNotCreateASession() async throws {
        let engine = LlamaCppMetalBackend(requireMetal: false)
        do {
            _ = try await engine.load(model: sampleModel(path: "/tmp/pocket-llama-missing-\(UUID().uuidString).gguf"))
            XCTFail("load returned a session")
        } catch LlamaEngineError.invalidModel {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testNonGgufDoesNotCreateASessionOrTokens() async throws {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("not-a-model-\(UUID().uuidString).gguf")
        try Data("this is not a gguf".utf8).write(to: url)
        defer { try? FileManager.default.removeItem(at: url) }
        let engine = LlamaCppMetalBackend(requireMetal: false)
        do {
            _ = try await engine.load(model: sampleModel(path: url.path))
            XCTFail("load returned a session")
        } catch LlamaEngineError.backendFailed {
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testEmptyPromptIsRejected() async throws {
        let engine = LlamaCppMetalBackend(requireMetal: false)
        let session = RuntimeSession(id: "missing", modelId: "missing")
        do {
            _ = try await engine.generate(session: session, request: GenerationRequest(prompt: "   ", maxTokens: 8, temperature: 0))
            XCTFail("generate returned a stream")
        } catch LlamaEngineError.invalidRequest {
        } catch LlamaEngineError.sessionNotLoaded {
            XCTFail("validation should reject the prompt before the session check")
        } catch {
            XCTFail("unexpected error \(error)")
        }
    }

    func testPinnedGgufCancellationBeforeStreamConsumptionIsNotErased() async throws {
        guard let path = SmokePath.path else {
            throw XCTSkip("No smoke GGUF path is configured for this run.")
        }
        guard FileManager.default.isReadableFile(atPath: path) else {
            if SmokePath.required {
                XCTFail("Smoke GGUF is not readable at \(path)")
            }
            throw XCTSkip("Smoke GGUF is not readable in this process.")
        }

        let probe = LlamaCppMetalBackend.probe()
        let engine = LlamaCppMetalBackend(requireMetal: probe.metalDeviceUsable)
        let session = try await engine.load(model: sampleModel(path: path))
        defer { Task { await engine.unload(sessionId: session.id) } }

        let cancelledRequestID = UUID().uuidString
        let pendingStream = try await engine.generate(
            session: session,
            request: GenerationRequest(
                requestId: cancelledRequestID,
                prompt: "Generate a long continuation for cancellation testing.",
                maxTokens: 256,
                temperature: 0
            )
        )

        // Cancel before attaching a stream consumer. The native task has been
        // published, but it may not yet have entered pocket_llama_generate.
        // Its cancellation flag must survive that later C entry point.
        await engine.cancelAndWait(sessionId: session.id, requestId: cancelledRequestID)
        do {
            for try await _ in pendingStream {
                XCTFail("A pre-consumption cancellation must not publish output.")
            }
            XCTFail("The cancelled stream must finish with cancellation.")
        } catch LlamaEngineError.cancelled {
            // Expected whether cancellation arrived before or during C decode.
        } catch {
            XCTFail("Expected native cancellation, received: \(error)")
        }

        let nextStream = try await engine.generate(
            session: session,
            request: GenerationRequest(
                requestId: UUID().uuidString,
                prompt: "The capital of France is",
                maxTokens: 8,
                temperature: 0
            )
        )
        var nextOutput = ""
        for try await token in nextStream {
            nextOutput += token.text
        }
        XCTAssertFalse(nextOutput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    func testPinnedGgufSmokeGeneration() async throws {
        guard let path = SmokePath.path else {
            throw XCTSkip("No smoke GGUF path is configured for this run.")
        }
        if !FileManager.default.isReadableFile(atPath: path) {
            if SmokePath.required {
                XCTFail("Smoke GGUF is not readable at \(path)")
            }
            throw XCTSkip("Smoke GGUF is not readable in this process.")
        }
        let probe = LlamaCppMetalBackend.probe()
        let engine = LlamaCppMetalBackend(requireMetal: probe.metalDeviceUsable)
        let session = try await engine.load(model: sampleModel(path: path))
        let report = await engine.offloadReport(sessionId: session.id)
        print("POCKET_LLAMA_OFFLOAD usable=\(probe.metalDeviceUsable) requested=\(report?.requestedGpuLayers ?? -999) layers=\(report?.offloadedLayers ?? -999) total=\(report?.reportedLayerCount ?? -999)")
        if probe.metalDeviceUsable {
            XCTAssertGreaterThan(report?.offloadedLayers ?? -1, 0, "Metal initialized but llama.cpp did not report a GPU layer offload")
        } else {
            XCTAssertLessThanOrEqual(report?.offloadedLayers ?? -1, 0)
            let refused = LlamaCppMetalBackend(requireMetal: true)
            do {
                _ = try await refused.load(model: sampleModel(path: path))
                XCTFail("requireMetal created a session without a usable Metal device")
            } catch LlamaEngineError.backendUnavailable {
            }
        }
        let stream = try await engine.generate(
            session: session,
            request: GenerationRequest(prompt: "The capital of France is", maxTokens: 8, temperature: 0)
        )
        var text = ""
        var count = 0
        for try await token in stream {
            count += 1
            XCTAssertTrue(token.isComplete)
            text += token.text
        }
        XCTAssertEqual(count, 1)
        XCTAssertFalse(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        XCTAssertNotEqual(text, "[placeholder inference]")
        print("POCKET_LLAMA_SMOKE chars=\(text.count) metalUsable=\(probe.metalDeviceUsable) offloaded=\(report?.offloadedLayers ?? -1)")
        await engine.unload(sessionId: session.id)
        let gone = RuntimeSession(id: session.id, modelId: session.modelId)
        do {
            _ = try await engine.generate(session: gone, request: sampleRequest())
            XCTFail("generate used an unloaded session")
        } catch LlamaEngineError.sessionNotLoaded {
        }
    }

    func testPinnedGgufSmokeGenerationThroughNativeInferenceRuntime() async throws {
        guard let path = SmokePath.path else {
            throw XCTSkip("No smoke GGUF path is configured for this run.")
        }
        guard FileManager.default.isReadableFile(atPath: path) else {
            if SmokePath.required {
                XCTFail("Smoke GGUF is not readable at \(path)")
            }
            throw XCTSkip("Smoke GGUF is not readable in this process.")
        }

        let modelURL = URL(fileURLWithPath: path)
        let digest = try Self.sha256(fileAt: modelURL)
        let model = ModelDescriptor(
            id: "sha256-\(digest)",
            name: "Pinned smoke GGUF",
            path: modelURL.path,
            contextLength: 512,
            quantization: "pinned-ci-smoke"
        )
        let probe = LlamaCppMetalBackend.probe()
        let engine = LlamaCppMetalBackend(requireMetal: probe.metalDeviceUsable)
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(
                maxResidentMemoryMB: 2_048,
                maxLoadedModels: 1,
                minimumFreeMemoryMB: 0
            ),
            availableMemoryMB: { 4_096 },
            maxConcurrentRequests: 1
        )
        let lease = try await runtime.acquire(model: model, estimatedMemoryMB: 512)

        do {
            let result = try await runtime.generateForEvaluation(
                lease: lease,
                request: GenerationRequest(
                    prompt: "The capital of France is",
                    maxTokens: 8,
                    temperature: 0
                )
            )
            XCTAssertEqual(runtime.providerKind, .llamaCpp)
            XCTAssertEqual(result.status, .completed)
            XCTAssertNil(result.errorMessage)
            XCTAssertFalse(result.output.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            XCTAssertEqual(try Self.sha256(fileAt: modelURL), digest, "The pinned model bytes changed during evaluation.")

            let afterGeneration = await runtime.snapshot()
            XCTAssertEqual(afterGeneration.activeLeaseCount, 1)
            XCTAssertEqual(afterGeneration.activeUseCount, 0)
            let released = await runtime.release(lease)
            XCTAssertTrue(released, "The exact evaluation lease must be releasable.")
            try await runtime.unload(modelId: model.id)

            let afterUnload = await runtime.snapshot()
            XCTAssertTrue(afterUnload.loadedModelIDs.isEmpty)
            XCTAssertEqual(afterUnload.reservedMemoryMB, 0)
            print("POCKET_LLAMA_EVALUATION_SMOKE provider=\(runtime.providerKind.rawValue) chars=\(result.output.count) model_sha256=\(digest) lease_released=\(released) unloaded=true metalUsable=\(probe.metalDeviceUsable)")
        } catch {
            _ = await runtime.release(lease)
            try? await runtime.unload(modelId: model.id)
            throw error
        }
    }

    private static func sha256(fileAt url: URL) throws -> String {
        var hasher = SHA256()
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        while let chunk = try handle.read(upToCount: 1_048_576), !chunk.isEmpty {
            hasher.update(data: chunk)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    func testLoopbackHostAndURLRules() throws {
        XCTAssertTrue(LlamaEngineSupport.isLoopbackHost("127.0.0.1"))
        XCTAssertTrue(LlamaEngineSupport.isLoopbackHost("localhost"))
        XCTAssertTrue(LlamaEngineSupport.isLoopbackHost("::1"))
        XCTAssertFalse(LlamaEngineSupport.isLoopbackHost("0.0.0.0"))
        XCTAssertFalse(LlamaEngineSupport.isLoopbackHost("10.0.0.8"))
        XCTAssertNoThrow(try LlamaEngineSupport.validateLoopbackBaseURL(URL(string: "http://127.0.0.1:8080")!))
        XCTAssertThrowsError(try LlamaEngineSupport.validateLoopbackBaseURL(URL(string: "http://127.0.0.1")!))
        XCTAssertThrowsError(try LlamaEngineSupport.validateLoopbackBaseURL(URL(string: "http://user:pass@127.0.0.1:8080")!))
        XCTAssertThrowsError(try LlamaEngineSupport.validateLoopbackBaseURL(URL(string: "http://127.0.0.1:8080?x=1")!))
        XCTAssertThrowsError(try LlamaEngineSupport.validateLoopbackBaseURL(URL(string: "http://127.0.0.1:8080#frag")!))
        XCTAssertThrowsError(try LlamaEngineSupport.validateLoopbackBaseURL(URL(string: "http://10.0.0.8:8080")!))
    }

    func testHealthAndCompletionFailClosed() throws {
        XCTAssertTrue(LlamaEngineSupport.healthIsReady(Data("{\"status\":\"ok\"}".utf8)))
        XCTAssertFalse(LlamaEngineSupport.healthIsReady(Data("{\"status\":\"loading\"}".utf8)))
        XCTAssertFalse(LlamaEngineSupport.healthIsReady(Data("not-json".utf8)))
        let hello = try LlamaEngineSupport.completionContent(Data("{\"content\":\"hello\"}".utf8))
        XCTAssertEqual(hello, "hello")
        XCTAssertThrowsError(try LlamaEngineSupport.completionContent(Data("{}".utf8)))
        XCTAssertThrowsError(try LlamaEngineSupport.completionContent(Data("[]".utf8)))
        XCTAssertThrowsError(try LlamaEngineSupport.completionContent(Data("{\"content\":\"\"}".utf8)))
    }

    func testGenerationRequestRequiresUUIDIdentity() throws {
        XCTAssertThrowsError(try LlamaEngineSupport.validateRequest(
            GenerationRequest(requestId: "not-a-uuid", prompt: "hello", maxTokens: 8, temperature: 0)
        ))
        XCTAssertNoThrow(try LlamaEngineSupport.validateRequest(
            GenerationRequest(requestId: UUID().uuidString, prompt: "hello", maxTokens: 8, temperature: 0)
        ))
    }

    func testModelAndRequestBounds() {
        XCTAssertThrowsError(try LlamaEngineSupport.validateModel(ModelDescriptor(id: " ", name: "n", path: "/m.gguf", contextLength: 512)))
        XCTAssertThrowsError(try LlamaEngineSupport.validateModel(ModelDescriptor(id: "m", name: "n", path: " ", contextLength: 512)))
        XCTAssertThrowsError(try LlamaEngineSupport.validateModel(ModelDescriptor(id: "m", name: "n", path: "/m.gguf", contextLength: 0)))
        XCTAssertThrowsError(try LlamaEngineSupport.validateModel(ModelDescriptor(id: "m", name: "n", path: "/m.gguf", contextLength: 8193)))
        XCTAssertThrowsError(try LlamaEngineSupport.validateRequest(GenerationRequest(prompt: " ", maxTokens: 8, temperature: 0)))
        XCTAssertThrowsError(try LlamaEngineSupport.validateRequest(GenerationRequest(prompt: "hi", maxTokens: 0, temperature: 0)))
        XCTAssertThrowsError(try LlamaEngineSupport.validateRequest(GenerationRequest(prompt: "hi", maxTokens: 8, temperature: 3)))
    }

    private func sampleModel(path: String) -> ModelDescriptor {
        ModelDescriptor(id: "smoke", name: "smoke", path: path, contextLength: 512, quantization: "Q4_K_M")
    }

    private func sampleRequest() -> GenerationRequest {
        GenerationRequest(prompt: "The capital of France is", maxTokens: 8, temperature: 0)
    }
}

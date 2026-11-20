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
        let latent = try await engine.generateWithLatent(
            session: session,
            request: GenerationRequest(prompt: "The capital of France is", maxTokens: 8, temperature: 0)
        )
        XCTAssertEqual(latent.modelId, session.modelId)
        XCTAssertFalse(latent.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        XCTAssertGreaterThan(latent.embedding.count, 0)
        XCTAssertEqual(latent.shape, [latent.embedding.count])
        XCTAssertTrue(latent.embedding.allSatisfy(\.isFinite))
        print("POCKET_LLAMA_LATENT dimension=\(latent.embedding.count) textChars=\(latent.text.count)")
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
            let latent = try await runtime.generateWithLatent(
                lease: lease,
                request: GenerationRequest(
                    prompt: "The capital of France is",
                    maxTokens: 8,
                    temperature: 0
                )
            )
            XCTAssertEqual(latent.modelId, model.id)
            XCTAssertFalse(latent.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            XCTAssertGreaterThan(latent.embedding.count, 0)
            XCTAssertEqual(latent.shape, [latent.embedding.count])
            XCTAssertTrue(latent.embedding.allSatisfy(\.isFinite))

            let latentSequence = try await runtime.generateWithLatentSequence(
                lease: lease,
                request: GenerationRequest(
                    prompt: "The capital of France is",
                    maxTokens: 8,
                    temperature: 0
                ),
                maxLatentTokens: 8,
                maxLatentBytes: 16 * 1024 * 1024
            )
            XCTAssertEqual(latentSequence.modelId, model.id)
            XCTAssertFalse(latentSequence.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            XCTAssertGreaterThanOrEqual(latentSequence.tokenCount, 2)
            XCTAssertLessThanOrEqual(latentSequence.tokenCount, 8)
            XCTAssertEqual(latentSequence.text, latent.text, "Greedy text generation must be identical for the same prompt and model.")
            XCTAssertEqual(latentSequence.embeddingDimension, latent.embedding.count)
            let sequenceFinalEmbedding = Array(latentSequence.embeddings.suffix(latentSequence.embeddingDimension))
            XCTAssertEqual(sequenceFinalEmbedding.count, latent.embedding.count)
            for (sequenceValue, finalValue) in zip(sequenceFinalEmbedding, latent.embedding) {
                XCTAssertEqual(sequenceValue, finalValue, accuracy: 1e-4,
                               "The final sequence row must match the standalone final-token embedding.")
            }
            XCTAssertGreaterThan(latentSequence.embeddingDimension, 0)
            XCTAssertEqual(latentSequence.shape, [latentSequence.tokenCount, latentSequence.embeddingDimension])
            XCTAssertEqual(latentSequence.embeddings.count, latentSequence.tokenCount * latentSequence.embeddingDimension)
            XCTAssertTrue(latentSequence.embeddings.allSatisfy(\.isFinite))
            print("POCKET_LLAMA_LATENT_SEQUENCE tokens=\(latentSequence.tokenCount) dimension=\(latentSequence.embeddingDimension) bytes=\(latentSequence.embeddings.count * MemoryLayout<Float>.size)")

            // Exercise a new, real llama.cpp generation through the complete
            // capture adapter. This codebook is synthetic and untrained: its
            // scalar [-1, +1] centroids validate plumbing, not task quality.
            let gieIdentity = NativeLatentModelIdentity(modelId: model.id, modelRevision: digest)
            let gieArtifact = try GIECodebookTestSupport.artifact(
                modelId: model.id, modelRevision: digest,
                embeddingDimension: latentSequence.embeddingDimension,
                maxTokensPerSegment: 4
            )
            let gieArtifactDigest = GIECodebookTestSupport.sha256(gieArtifact)
            let gie = try await NativeGIECaptureEncoder.generate(
                runtime: runtime, lease: lease,
                request: GenerationRequest(
                    prompt: "The capital of France is", maxTokens: 8, temperature: 0
                ),
                expectedModelIdentity: gieIdentity,
                codebookArtifact: gieArtifact,
                expectedCodebookSHA256: gieArtifactDigest,
                maxLatentTokens: 8,
                maxLatentBytes: 8 * latentSequence.embeddingDimension * MemoryLayout<Float>.size
            )
            XCTAssertEqual(gie.providerKind, .llamaCpp)
            XCTAssertEqual(gie.modelIdentity, gieIdentity)
            XCTAssertEqual(gie.codebookSHA256, gieArtifactDigest)
            XCTAssertEqual(gie.text, latentSequence.text)
            XCTAssertEqual(gie.tokenCount, latentSequence.tokenCount)
            XCTAssertEqual(gie.embeddingDimension, latentSequence.embeddingDimension)
            XCTAssertGreaterThan(gie.tokenCount, 0)
            XCTAssertLessThanOrEqual(gie.tokenCount, 8)

            let gieCodebook = try NativeGIECodebookArtifact.load(
                gieArtifact, expectedSHA256: gieArtifactDigest, expectedModelIdentity: gieIdentity
            )
            let gieDecoded = try NativeGIESequenceCodec(codebook: gieCodebook).decode(
                gie.payload, modelIdentity: gieIdentity
            )
            let expectedSpans = stride(from: 0, to: gie.tokenCount, by: 4).map {
                min(4, gie.tokenCount - $0)
            }
            XCTAssertEqual(gieDecoded.tokenCount, gie.tokenCount)
            XCTAssertEqual(gieDecoded.embeddingDimension, gie.embeddingDimension)
            XCTAssertEqual(gieDecoded.segmentTokenCounts, expectedSpans)
            XCTAssertEqual(gieDecoded.segmentTokenCounts.reduce(0, +), gie.tokenCount)
            XCTAssertEqual(gieDecoded.segmentEmbeddings.count, expectedSpans.count * gie.embeddingDimension)
            XCTAssertTrue(gieDecoded.segmentEmbeddings.allSatisfy { $0.isFinite && ($0 == -1 || $0 == 1) })
            XCTAssertEqual(gie.payloadByteLength, 50 + expectedSpans.count * (2 + gie.embeddingDimension))
            // Separate native generations may differ at a quantization boundary;
            // the shared deterministic fixture owns exact encoded-byte parity.
            print("POCKET_LLAMA_GIE_CAPTURE provider=\(gie.providerKind.rawValue) model_sha256=\(digest) codebook=synthetic-untrained codebook_sha256=\(gie.codebookSHA256) tokens=\(gie.tokenCount) dimension=\(gie.embeddingDimension) segments=\(expectedSpans.count) payloadBytes=\(gie.payloadByteLength)")

            // Keep ordinary-generation controls adjacent to the numerical-input
            // intervention. The older latent reference used a capture-enabled
            // decode graph, and the initial ordinary result preceded several
            // capture calls; neither alone isolates raw-input state restoration.
            let textBeforeInputs = try await runtime.generate(
                lease: lease,
                request: GenerationRequest(prompt: "The capital of France is", maxTokens: 8, temperature: 0)
            )
            let textBeforeInputsRepeat = try await runtime.generate(
                lease: lease,
                request: GenerationRequest(prompt: "The capital of France is", maxTokens: 8, temperature: 0)
            )
            var controlOutputs = [
                "initialOrdinary": result.output,
                "earlierCaptured": latent.text,
                "ordinaryBeforeInputs": textBeforeInputs,
                "ordinaryBeforeInputsRepeat": textBeforeInputsRepeat
            ]
            var controlMatches = [
                "ordinaryControlsMatch": textBeforeInputs == textBeforeInputsRepeat,
                "initialOrdinaryMatchesControl": result.output == textBeforeInputsRepeat,
                "earlierCapturedMatchesControl": latent.text == textBeforeInputsRepeat
            ]
            try Self.emitTextControls(stage: "before-inputs", modelSHA256: digest,
                                      outputs: controlOutputs, matches: controlMatches)
            XCTAssertFalse(textBeforeInputs.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            XCTAssertFalse(textBeforeInputsRepeat.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            XCTAssertEqual(textBeforeInputs, textBeforeInputsRepeat,
                           "Ordinary greedy generation must be repeatable before the raw-input intervention.")

            // Raw first-layer inputs are a separate representation from the
            // captured/pooled final-layer GIE vectors above. These deterministic,
            // non-collinear matrices are synthetic numerical probes, not tokens
            // or a trained representation mapping. A/B/A must test actual model
            // computation and independent context resets through the same lease.
            let inputCapabilities = try await runtime.inputEmbeddingCapabilities(lease: lease)
            XCTAssertEqual(inputCapabilities.modelId, model.id)
            XCTAssertGreaterThanOrEqual(inputCapabilities.maxTokenCount, 2)
            let inputRows = 2
            let inputWidth = inputCapabilities.inputDimension
            let inputsA: [Float] = (0..<(inputRows * inputWidth)).map {
                Float(($0 * 17 + 3) % 41 - 20) / 128
            }
            let inputsB: [Float] = (0..<(inputRows * inputWidth)).map {
                Float(($0 * 29 + 11) % 43 - 21) / 96
            }
            var inputResults: [NativeInputEmbeddingEvaluationResult] = []
            for matrix in [inputsA, inputsB, inputsA] {
                let inputRequest = NativeInputEmbeddingRequest(
                    modelId: model.id, tokenCount: inputRows,
                    embeddingDimension: inputWidth, embeddings: matrix
                )
                let evaluated = try await runtime.evaluateInputEmbeddings(lease: lease, request: inputRequest)
                XCTAssertEqual(evaluated.requestId, inputRequest.requestId)
                XCTAssertEqual(evaluated.modelId, model.id)
                XCTAssertEqual(evaluated.tokenCount, inputRows)
                XCTAssertEqual(evaluated.embeddingDimension, inputWidth)
                XCTAssertEqual(evaluated.logits.count, inputCapabilities.vocabularySize)
                XCTAssertTrue(evaluated.logits.allSatisfy(\.isFinite))
                inputResults.append(evaluated)
            }
            let repeatMaxDelta = zip(inputResults[0].logits, inputResults[2].logits)
                .map { abs(Double($0.0) - Double($0.1)) }.max() ?? .infinity
            let changedMaxDelta = zip(inputResults[0].logits, inputResults[1].logits)
                .map { abs(Double($0.0) - Double($0.1)) }.max() ?? 0
            // Absolute logit tolerance, not text/hash equality. The changed input
            // must exceed both a fixed numerical floor and measured repeat noise.
            let repeatTolerance = 1e-3
            XCTAssertLessThanOrEqual(repeatMaxDelta, repeatTolerance)
            XCTAssertGreaterThan(changedMaxDelta, max(1e-2, repeatMaxDelta * 100))

            let textAfterInputs = try await runtime.generate(
                lease: lease,
                request: GenerationRequest(prompt: "The capital of France is", maxTokens: 8, temperature: 0)
            )
            let textAfterMatchesControl = textAfterInputs == textBeforeInputsRepeat
            let textAfterMatchesCaptured = textAfterInputs == latent.text
            controlOutputs["ordinaryAfterInputs"] = textAfterInputs
            controlMatches["ordinaryAfterMatchesControl"] = textAfterMatchesControl
            controlMatches["ordinaryAfterMatchesCaptured"] = textAfterMatchesCaptured
            try Self.emitTextControls(stage: "after-inputs", modelSHA256: digest,
                                      outputs: controlOutputs, matches: controlMatches)
            XCTAssertFalse(textAfterInputs.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            XCTAssertEqual(textAfterInputs, textBeforeInputsRepeat,
                           "Stateless raw input evaluation must preserve its immediate ordinary greedy text control.")
            // Retain the existing compatibility gate while diagnosing it. A
            // passing same-mode comparison does not waive a cross-mode failure.
            XCTAssertEqual(textAfterInputs, latent.text, "Stateless raw input evaluation must preserve the ordinary greedy text path.")
            let afterInputs = await runtime.snapshot()
            let schedulerAfterInputs = await runtime.schedulerSnapshot()
            XCTAssertEqual(afterInputs.activeUseCount, 0)
            XCTAssertEqual(schedulerAfterInputs.activeRequests, 0)
            XCTAssertEqual(schedulerAfterInputs.waitingRequests, 0)
            print("POCKET_LLAMA_INPUT_EMBEDDING provider=\(runtime.providerKind.rawValue) model_sha256=\(digest) input=synthetic-first-layer sequence=A-B-A rows=\(inputRows) dimension=\(inputWidth) logits=\(inputCapabilities.vocabularySize) repeatMaxDelta=\(repeatMaxDelta) changedMaxDelta=\(changedMaxDelta) repeatTolerance=\(repeatTolerance) ordinaryControlsMatch=\(textBeforeInputs == textBeforeInputsRepeat) textAfterMatchesControl=\(textAfterMatchesControl) textAfterMatchesCaptured=\(textAfterMatchesCaptured)")

            // Exercise the complete native path: llama.cpp final-token embedding
            // -> same-model int8 codec -> binary blob reference -> digest/replay
            // checks -> reconstructed vector. Authorization remains injected.
            // Freeze to a representable whole second: ISO8601 encoding may
            // round fractional seconds, otherwise the decoded createdAt can
            // appear later than the frozen now and spuriously fail expiry.
            let channelNow = Date(timeIntervalSince1970: 1_700_000_000)
            let latentStore = InMemoryNativeLatentBlobStore(now: { channelNow })
            let replayGuard = InMemoryNativeLatentReplayGuard(now: { channelNow })
            let latentIdentity = NativeLatentModelIdentity(modelId: model.id, modelRevision: digest)
            let senderChannel = NativeLatentChannel(
                localAgentId: "researcher",
                modelIdentity: latentIdentity,
                blobStore: latentStore,
                authorization: StaticNativeLatentAuthorization(allowed: true),
                replayGuard: replayGuard,
                now: { channelNow }
            )
            let recipientChannel = NativeLatentChannel(
                localAgentId: "critic",
                modelIdentity: latentIdentity,
                blobStore: latentStore,
                authorization: StaticNativeLatentAuthorization(allowed: true),
                replayGuard: replayGuard,
                now: { channelNow }
            )
            let latentEnvelope = try await senderChannel.send(
                output: latent,
                taskId: "native-smoke-task",
                conversationId: "native-smoke-conversation",
                recipientAgentId: "critic",
                sequence: 0,
                expiresAt: channelNow.addingTimeInterval(300)
            )
            let reconstructed = try await recipientChannel.receive(
                latentEnvelope,
                expectedTaskId: "native-smoke-task",
                expectedConversationId: "native-smoke-conversation",
                expectedSenderAgentId: "researcher"
            )
            let latentSquaredError = zip(latent.embedding, reconstructed.embedding).reduce(0.0) { partial, pair in
                let delta = Double(pair.0 - pair.1)
                return partial + delta * delta
            }
            let latentRMSE = sqrt(latentSquaredError / Double(latent.embedding.count))
            XCTAssertEqual(reconstructed.embedding.count, latent.embedding.count)
            XCTAssertLessThan(latentRMSE, 0.1)
            XCTAssertLessThan(latentEnvelope.payload.byteLength, latent.embedding.count * MemoryLayout<Float>.size)
            print("POCKET_LLAMA_LATENT_CHANNEL dimension=\\(latent.embedding.count) payloadBytes=\\(latentEnvelope.payload.byteLength) rawFloat32Bytes=\\(latent.embedding.count * MemoryLayout<Float>.size) rmse=\\(latentRMSE)")
            XCTAssertEqual(try Self.sha256(fileAt: modelURL), digest, "The pinned model bytes changed during evaluation.")

            let afterGeneration = await runtime.snapshot()
            XCTAssertEqual(afterGeneration.activeLeaseCount, 1)
            XCTAssertEqual(afterGeneration.activeUseCount, 0)
            let afterGenerationScheduler = await runtime.schedulerSnapshot()
            XCTAssertEqual(afterGenerationScheduler.activeRequests, 0)
            XCTAssertEqual(afterGenerationScheduler.waitingRequests, 0)
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

    private static func emitTextControls(
        stage: String, modelSHA256: String, outputs: [String: String], matches: [String: Bool]
    ) throws {
        let record: [String: Any] = [
            "stage": stage, "modelSHA256": modelSHA256,
            "outputs": outputs, "matches": matches
        ]
        var line = Data("POCKET_LLAMA_TEXT_CONTROLS ".utf8)
        line.append(try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]))
        line.append(0x0A)
        // Preserve exact, escaped controls even if later native work times out.
        FileHandle.standardOutput.write(line)
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

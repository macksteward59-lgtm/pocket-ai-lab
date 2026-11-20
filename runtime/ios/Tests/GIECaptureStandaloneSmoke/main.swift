import Foundation

/// An executable integration probe for the REAL native model-pool, scheduler,
/// bounded-sequence adapter, GCB1 loader and GIE1 encoder. The engine is
/// deliberately a fixture actor: this is NOT llama.cpp or physical-iPhone proof.
private struct Artifact: Decodable {
    let artifactHex: String
    let sha256: String
    let modelId: String
    let modelRevision: String
}

private struct Sequence: Decodable {
    let tokenCount: Int
    let embeddingDimension: Int
    let tokenEmbeddings: [Float]
    let payloadHex: String
    let segmentTokenCounts: [Int]
    let decodedSegmentEmbeddings: [Float]
}

private enum CheckFailure: Error {
    case mismatch(String)
    case invalidHex
}

private func bytes(hex: String) throws -> Data {
    guard hex.utf8.count.isMultiple(of: 2) else { throw CheckFailure.invalidHex }
    var data = Data()
    var index = hex.startIndex
    while index < hex.endIndex {
        let next = hex.index(index, offsetBy: 2)
        guard let value = UInt8(hex[index..<next], radix: 16) else {
            throw CheckFailure.invalidHex
        }
        data.append(value)
        index = next
    }
    return data
}

private func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
    if !condition() { throw CheckFailure.mismatch(message) }
}

private actor FixtureEngine: LatentSequenceExportingLlamaEngine {
    let fixture: LlamaLatentSequenceOutput
    private var calls = 0

    init(fixture: LlamaLatentSequenceOutput) { self.fixture = fixture }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: UUID().uuidString, modelId: model.id)
    }
    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        throw LlamaEngineError.backendUnavailable("fixture-only engine: no text inference")
    }
    func generateWithLatent(session: RuntimeSession, request: GenerationRequest) async throws -> LlamaLatentOutput {
        throw LlamaEngineError.backendUnavailable("fixture-only engine: no final token")
    }
    func generateWithLatentSequence(
        session: RuntimeSession, request: GenerationRequest,
        maxLatentTokens: Int, maxLatentBytes: Int
    ) async throws -> LlamaLatentSequenceOutput {
        calls += 1
        return fixture
    }
    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
    func count() -> Int { calls }
}

@main
private enum GIECaptureSmoke {
    static func main() async {
        do {
            try await run()
        } catch {
            fputs("POCKET_GIE_CAPTURE_FAILED: \(error)\n", stderr)
            exit(EXIT_FAILURE)
        }
    }

    private static func run() async throws {
        guard CommandLine.arguments.count == 3 else {
            throw CheckFailure.mismatch("usage: gie-capture-smoke <GCB1-fixture> <GIE1-fixture>")
        }
        let artifact = try JSONDecoder().decode(
            Artifact.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
        )
        let sample = try JSONDecoder().decode(
            Sequence.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2]))
        )
        let codebookBytes = try bytes(hex: artifact.artifactHex)
        let identity = NativeLatentModelIdentity(
            modelId: artifact.modelId, modelRevision: artifact.modelRevision
        )
        let source = LlamaLatentSequenceOutput(
            modelId: artifact.modelId,
            text: "synthetic, not real llama.cpp inference",
            embeddings: sample.tokenEmbeddings,
            tokenCount: sample.tokenCount,
            embeddingDimension: sample.embeddingDimension
        )
        let engine = FixtureEngine(fixture: source)
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(
                maxResidentMemoryMB: 1024, maxLoadedModels: 1, minimumFreeMemoryMB: 0
            ),
            availableMemoryMB: { 2048 },
            maxConcurrentRequests: 1
        )
        let model = ModelDescriptor(
            id: artifact.modelId, name: "fixture only", path: "/tmp/synthetic-gguf-path",
            contextLength: 512
        )
        let lease = try await runtime.acquire(model: model, estimatedMemoryMB: 128)
        let request = GenerationRequest(prompt: "Synthetic sequence", maxTokens: sample.tokenCount, temperature: 0)

        // Codebook preflight must fail before invoking any engine attempt.
        do {
            _ = try await NativeGIECaptureEncoder.generate(
                runtime: runtime, lease: lease, request: request,
                expectedModelIdentity: identity, codebookArtifact: codebookBytes,
                expectedCodebookSHA256: String(repeating: "0", count: 64)
            )
            throw CheckFailure.mismatch("wrong codebook digest was accepted")
        } catch NativeGIESequenceCodecError.codebookMismatch {
            // Correct fail-closed behavior.
        }
        let before = await engine.count()
        try check(before == 0, "codebook preflight performed inference")

        let encoded = try await NativeGIECaptureEncoder.generate(
            runtime: runtime, lease: lease, request: request,
            expectedModelIdentity: identity,
            codebookArtifact: codebookBytes,
            expectedCodebookSHA256: artifact.sha256,
            maxLatentTokens: sample.tokenCount
        )
        let after = await engine.count()
        try check(after == 1, "expected exactly one fixture-engine sequence call")
        try check(encoded.providerKind == .other, "mock engine claimed llama.cpp identity")
        try check(encoded.modelIdentity == identity, "wrong model or revision")
        let expectedPayload = try bytes(hex: sample.payloadHex)
        try check(encoded.payload == expectedPayload, "GIE1 bytes differ from TypeScript fixture")
        let codebook = try NativeGIECodebookArtifact.load(
            codebookBytes, expectedSHA256: artifact.sha256, expectedModelIdentity: identity
        )
        let decoded = try NativeGIESequenceCodec(codebook: codebook).decode(
            encoded.payload, modelIdentity: identity
        )
        try check(decoded.segmentTokenCounts == sample.segmentTokenCounts, "ordered spans")
        try check(decoded.segmentEmbeddings == sample.decodedSegmentEmbeddings, "pooled vectors")
        let snapshot = await runtime.snapshot()
        try check(snapshot.activeUseCount == 0, "model use pin leaked")
        try check(snapshot.activeLeaseCount == 1, "lease released unexpectedly")
        let released = await runtime.release(lease)
        try check(released, "lease release failed")
        try await runtime.unload(modelId: model.id)
        print("POCKET_GIE_CAPTURE_OK execution=fixture-engine nativeProvider=other GIE1Bytes=\(encoded.payload.count) segments=\(decoded.segmentTokenCounts.count) generationCalls=\(after)")
    }
}

import XCTest
@testable import PocketLlamaEngine

final class NativeLatentChannelTests: XCTestCase {
    private let fixedNow = Date(timeIntervalSince1970: 1_800_000_000)

    private var modelIdentity: NativeLatentModelIdentity {
        NativeLatentModelIdentity(modelId: "sha256:model-fixture", modelRevision: "sha256:revision-1")
    }

    private func makeChannels(
        store: any NativeLatentBlobStore = InMemoryNativeLatentBlobStore(now: { Date(timeIntervalSince1970: 1_800_000_000) }),
        authorization: any NativeLatentAuthorization = StaticNativeLatentAuthorization(allowed: true)
    ) -> (NativeLatentChannel, NativeLatentChannel, InMemoryNativeLatentReplayGuard) {
        let replay = InMemoryNativeLatentReplayGuard(now: { Date(timeIntervalSince1970: 1_800_000_000) })
        let sender = NativeLatentChannel(
            localAgentId: "researcher",
            modelIdentity: modelIdentity,
            blobStore: store,
            authorization: authorization,
            replayGuard: replay,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )
        let recipient = NativeLatentChannel(
            localAgentId: "critic",
            modelIdentity: modelIdentity,
            blobStore: store,
            authorization: authorization,
            replayGuard: replay,
            now: { Date(timeIntervalSince1970: 1_800_000_000) }
        )
        return (sender, recipient, replay)
    }

    private func output(_ values: [Float], modelId: String? = nil) -> LlamaLatentOutput {
        LlamaLatentOutput(
            modelId: modelId ?? modelIdentity.modelId,
            text: "native inference output",
            embedding: values
        )
    }

    func testAffineInt8CodecMatchesCrossRuntimeWireFixture() throws {
        let codec = AffineInt8NativeLatentCodec(modelIdentity: modelIdentity)
        let bytes = try codec.encode(output([-1, 0, 1]))
        XCTAssertEqual(
            Array(bytes),
            [0, 0, 128, 191, 0, 0, 128, 63, 129, 0, 127]
        )
    }

    func testAffineInt8CodecReducesPayloadAndBoundsReconstructionError() throws {
        let values = (0..<1_024).map { Float(sin(Double($0) / 19) * 2.5) }
        let codec = AffineInt8NativeLatentCodec(modelIdentity: modelIdentity)
        let bytes = try codec.encode(output(values))
        let decoded = try codec.decode(bytes, shape: [values.count], modelIdentity: modelIdentity)
        let squaredError = zip(values, decoded).reduce(0.0) { partial, pair in
            let delta = Double(pair.0 - pair.1)
            return partial + delta * delta
        }
        let rmse = sqrt(squaredError / Double(values.count))
        XCTAssertEqual(bytes.count, values.count + 8)
        XCTAssertLessThan(bytes.count, values.count * MemoryLayout<Float>.size / 3)
        XCTAssertLessThan(rmse, 0.02)
    }

    func testNativeChannelTransfersAndRejectsReplayAndWrongConversation() async throws {
        let (sender, recipient, _) = makeChannels()
        let values = (0..<512).map { Float(cos(Double($0) / 13)) }
        let envelope = try await sender.send(
            output: output(values),
            taskId: "task-1",
            conversationId: "conversation-1",
            recipientAgentId: "critic",
            sequence: 4,
            expiresAt: fixedNow.addingTimeInterval(300)
        )

        let received = try await recipient.receive(
            envelope,
            expectedTaskId: "task-1",
            expectedConversationId: "conversation-1",
            expectedSenderAgentId: "researcher"
        )
        XCTAssertEqual(received.modelIdentity, modelIdentity)
        XCTAssertEqual(received.shape, [values.count])
        XCTAssertEqual(received.embedding.count, values.count)
        XCTAssertEqual(received.transferId, envelope.transferId)

        do {
            _ = try await recipient.receive(
                envelope,
                expectedTaskId: "task-1",
                expectedConversationId: "different-conversation",
                expectedSenderAgentId: "researcher"
            )
            XCTFail("A transfer must not cross conversation boundaries.")
        } catch NativeLatentChannelError.invalidRoute {}

        let futureDated = NativeLatentTransferEnvelope(
            protocolVersion: envelope.protocolVersion,
            transferId: envelope.transferId,
            taskId: envelope.taskId,
            conversationId: envelope.conversationId,
            senderAgentId: envelope.senderAgentId,
            recipientAgentId: envelope.recipientAgentId,
            sequence: envelope.sequence,
            createdAt: ISO8601DateFormatter().string(from: fixedNow.addingTimeInterval(30)),
            expiresAt: envelope.expiresAt,
            codec: envelope.codec,
            shape: envelope.shape,
            payload: envelope.payload
        )
        do {
            _ = try await recipient.receive(
                futureDated,
                expectedTaskId: "task-1",
                expectedConversationId: "conversation-1",
                expectedSenderAgentId: "researcher"
            )
            XCTFail("A future-dated transfer must be rejected.")
        } catch NativeLatentChannelError.invalidExpiry {}

        do {
            _ = try await recipient.receive(
                envelope,
                expectedTaskId: "task-1",
                expectedConversationId: "conversation-1",
                expectedSenderAgentId: "researcher"
            )
            XCTFail("A transfer sequence must not be replayed.")
        } catch NativeLatentChannelError.replayRejected {}
    }

    func testSequenceMustFitSharedJSONSafeIntegerRange() async throws {
        let (sender, _, _) = makeChannels()
        do {
            _ = try await sender.send(
                output: output([0.1, 0.2]),
                taskId: "task-1",
                conversationId: "conversation-1",
                recipientAgentId: "critic",
                sequence: UInt64.max,
                expiresAt: fixedNow.addingTimeInterval(300)
            )
            XCTFail("A sequence outside JavaScript's safe integer range must be rejected.")
        } catch NativeLatentChannelError.invalidSequence {}
    }

    func testAuthorizationDenialPreventsBlobCreation() async throws {
        let now = fixedNow
        let store = InMemoryNativeLatentBlobStore(now: { now })
        let (sender, _, _) = makeChannels(
            store: store,
            authorization: StaticNativeLatentAuthorization(allowed: false)
        )
        do {
            _ = try await sender.send(
                output: output([0.1, 0.2]),
                taskId: "task-1",
                conversationId: "conversation-1",
                recipientAgentId: "critic",
                sequence: 0,
                expiresAt: fixedNow.addingTimeInterval(300)
            )
            XCTFail("Unauthorized latent transfer must fail closed.")
        } catch NativeLatentChannelError.authorizationDenied {}
        let storedCount = await store.count()
        XCTAssertEqual(storedCount, 0)
    }

    func testEmptyBlobReferenceIsRejectedBeforeLookup() async throws {
        let (sender, recipient, _) = makeChannels()
        let envelope = try await sender.send(
            output: output([0.1, 0.2, 0.3]),
            taskId: "task-1",
            conversationId: "conversation-1",
            recipientAgentId: "critic",
            sequence: 3,
            expiresAt: fixedNow.addingTimeInterval(300)
        )
        let invalid = NativeLatentTransferEnvelope(
            protocolVersion: envelope.protocolVersion,
            transferId: envelope.transferId,
            taskId: envelope.taskId,
            conversationId: envelope.conversationId,
            senderAgentId: envelope.senderAgentId,
            recipientAgentId: envelope.recipientAgentId,
            sequence: envelope.sequence,
            createdAt: envelope.createdAt,
            expiresAt: envelope.expiresAt,
            codec: envelope.codec,
            shape: envelope.shape,
            payload: NativeLatentPayloadReference(
                blobRef: "",
                byteLength: envelope.payload.byteLength,
                sha256: envelope.payload.sha256
            )
        )
        do {
            _ = try await recipient.receive(
                invalid,
                expectedTaskId: "task-1",
                expectedConversationId: "conversation-1",
                expectedSenderAgentId: "researcher"
            )
            XCTFail("An empty blob reference must be rejected before storage lookup.")
        } catch NativeLatentChannelError.invalidBlobReceipt {}
    }

    func testUppercaseBlobDigestReceiptIsCanonicalizedAcrossRuntimes() async throws {
        let store = UppercaseDigestNativeLatentBlobStore()
        let (sender, recipient, _) = makeChannels(store: store)
        let envelope = try await sender.send(
            output: output([0.1, 0.2, 0.3]),
            taskId: "task-1",
            conversationId: "conversation-1",
            recipientAgentId: "critic",
            sequence: 8,
            expiresAt: fixedNow.addingTimeInterval(300)
        )
        XCTAssertEqual(envelope.payload.sha256, envelope.payload.sha256.lowercased())
        let received = try await recipient.receive(
            envelope,
            expectedTaskId: "task-1",
            expectedConversationId: "conversation-1",
            expectedSenderAgentId: "researcher"
        )
        XCTAssertEqual(received.embedding.count, 3)
    }

    func testTamperedBlobIsRejectedBeforeDecode() async throws {
        let store = TamperingNativeLatentBlobStore()
        let (sender, recipient, _) = makeChannels(store: store)
        let envelope = try await sender.send(
            output: output([0.1, 0.2, 0.3, 0.4]),
            taskId: "task-1",
            conversationId: "conversation-1",
            recipientAgentId: "critic",
            sequence: 1,
            expiresAt: fixedNow.addingTimeInterval(300)
        )
        do {
            _ = try await recipient.receive(
                envelope,
                expectedTaskId: "task-1",
                expectedConversationId: "conversation-1",
                expectedSenderAgentId: "researcher"
            )
            XCTFail("A modified binary payload must not reach the decoder.")
        } catch NativeLatentChannelError.payloadDigestMismatch {}
    }

    func testCodecHandlesConstantAndExtremeFiniteFloatValues() throws {
        let codec = AffineInt8NativeLatentCodec(modelIdentity: modelIdentity)
        let constant = try codec.encode(output([7.25, 7.25, 7.25]))
        XCTAssertEqual(try codec.decode(constant, shape: [3], modelIdentity: modelIdentity), [7.25, 7.25, 7.25])

        let extreme: [Float] = [-3e38, -1e38, 0, 1e38, 3e38]
        let encoded = try codec.encode(output(extreme))
        let decoded = try codec.decode(encoded, shape: [extreme.count], modelIdentity: modelIdentity)
        XCTAssertTrue(decoded.allSatisfy(\.isFinite))
        XCTAssertEqual(decoded.first, extreme.first)
        XCTAssertEqual(decoded.last, extreme.last)
    }

    func testCodecRejectsWrongModelRevisionAndMalformedShape() throws {
        let codec = AffineInt8NativeLatentCodec(modelIdentity: modelIdentity)
        XCTAssertThrowsError(try codec.encode(output([0.1], modelId: "different-model")))
        XCTAssertThrowsError(try codec.decode(
            Data(repeating: 0, count: 9),
            shape: [1],
            modelIdentity: NativeLatentModelIdentity(modelId: modelIdentity.modelId, modelRevision: "revision-2")
        ))
        XCTAssertThrowsError(try codec.encode(LlamaLatentOutput(
            modelId: modelIdentity.modelId,
            text: "invalid shape",
            embedding: []
        )))
    }

    func testEnvelopeIsCodableWithoutEmbeddingBytes() async throws {
        let (sender, _, _) = makeChannels()
        let envelope = try await sender.send(
            output: output([0.1, 0.2, 0.3]),
            taskId: "task-1",
            conversationId: "conversation-1",
            recipientAgentId: "critic",
            sequence: 2,
            expiresAt: fixedNow.addingTimeInterval(300)
        )
        let encoded = try JSONEncoder().encode(envelope)
        let decoded = try JSONDecoder().decode(NativeLatentTransferEnvelope.self, from: encoded)
        XCTAssertEqual(decoded, envelope)
        XCTAssertNil(encoded.range(of: Data([0x3f, 0x80, 0x00, 0x00])), "Envelope should contain only metadata and a blob reference.")
    }
}

private actor TamperingNativeLatentBlobStore: NativeLatentBlobStore {
    private var stored: Data?
    private var reference: String?

    func put(_ data: Data, expiresAt: Date) async throws -> NativeLatentPayloadReference {
        let id = "tamper:" + UUID().uuidString
        stored = Data(data)
        reference = id
        return NativeLatentPayloadReference(
            blobRef: id,
            byteLength: data.count,
            sha256: NativeLatentSHA256.digest(data)
        )
    }

    func get(_ requested: String) async throws -> Data? {
        guard requested == reference, var data = stored, data.count > 8 else { return nil }
        data[8] ^= 0x01
        return data
    }
}
private actor UppercaseDigestNativeLatentBlobStore: NativeLatentBlobStore {
    private var entries: [String: Data] = [:]

    func put(_ data: Data, expiresAt: Date) async throws -> NativeLatentPayloadReference {
        let reference = "uppercase:" + UUID().uuidString
        entries[reference] = Data(data)
        return NativeLatentPayloadReference(
            blobRef: reference,
            byteLength: data.count,
            sha256: NativeLatentSHA256.digest(data).uppercased()
        )
    }

    func get(_ reference: String) async throws -> Data? {
        entries[reference].map { Data($0) }
    }
}


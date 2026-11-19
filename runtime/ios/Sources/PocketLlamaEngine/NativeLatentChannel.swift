import Foundation
import CryptoKit

public struct NativeLatentModelIdentity: Codable, Sendable, Equatable {
    public let modelId: String
    public let modelRevision: String

    public init(modelId: String, modelRevision: String) {
        self.modelId = modelId
        self.modelRevision = modelRevision
    }
}

public enum NativeLatentDType: String, Codable, Sendable {
    case int8
}

/// Mirrors the TypeScript LatentCodecSelection wire contract.
public struct NativeLatentCodecSelection: Codable, Sendable, Equatable {
    public let codecId: String
    public let codecVersion: String
    public let encoderModel: NativeLatentModelIdentity
    public let decoderModel: NativeLatentModelIdentity
    public let dtype: NativeLatentDType
    public let maxPayloadBytes: Int
}

/// Mirrors the TypeScript LatentPayloadReference wire contract.
public struct NativeLatentPayloadReference: Codable, Sendable, Equatable {
    public let blobRef: String
    public let byteLength: Int
    public let sha256: String
}

/// Mirrors LatentTransferEnvelope v1. Timestamps are ISO-8601 strings and
/// binary tensor data remains out-of-band in the referenced blob.
public struct NativeLatentTransferEnvelope: Codable, Sendable, Equatable {
    public let protocolVersion: Int
    public let transferId: UUID
    public let taskId: String
    public let conversationId: String
    public let senderAgentId: String
    public let recipientAgentId: String
    public let sequence: UInt64
    public let createdAt: String
    public let expiresAt: String
    public let codec: NativeLatentCodecSelection
    public let shape: [Int]
    public let payload: NativeLatentPayloadReference
}

public struct NativeLatentReceived: Sendable, Equatable {
    public let transferId: UUID
    public let senderAgentId: String
    public let modelIdentity: NativeLatentModelIdentity
    public let shape: [Int]
    public let embedding: [Float]
}

public protocol NativeLatentBlobStore: Sendable {
    func put(_ data: Data, expiresAt: Date) async throws -> NativeLatentPayloadReference
    func get(_ reference: String) async throws -> Data?
}

public protocol NativeLatentAuthorization: Sendable {
    func authorize(
        taskId: String,
        conversationId: String,
        senderAgentId: String,
        recipientAgentId: String,
        codec: NativeLatentCodecSelection,
        payloadByteCount: Int
    ) async -> Bool
}

public protocol NativeLatentReplayGuard: Sendable {
    /// Atomically claims a transfer sequence until its expiry.
    func claim(_ key: String, expiresAt: Date) async -> Bool
}

public enum NativeLatentChannelError: Error, Equatable, Sendable {
    case invalidIdentity
    case invalidRoute
    case invalidShape
    case invalidExpiry
    case unsupportedCodec
    case authorizationDenied
    case invalidBlobReceipt
    case missingBlob
    case payloadLengthMismatch
    case payloadDigestMismatch
    case replayRejected
    case invalidDecodedVector
}

/// SHA-256 digest adapter implemented with Apple's CryptoKit.
public enum NativeLatentSHA256 {
    public static func digest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}

/// Same-model affine int8 scalar quantizer. This is deliberately not a
/// cross-model alignment codec: both ends must use the exact same model ID
/// and immutable revision supplied by the host.
public struct AffineInt8NativeLatentCodec: Sendable {
    public static let codecId = "pocket-affine-int8"
    public static let codecVersion = "1"
    public static let maximumElements = 65_536
    public static let maximumPayloadBytes = maximumElements + 8

    public let modelIdentity: NativeLatentModelIdentity

    public init(modelIdentity: NativeLatentModelIdentity) {
        self.modelIdentity = modelIdentity
    }

    public func encode(_ output: LlamaLatentOutput) throws -> Data {
        guard output.modelId == modelIdentity.modelId,
              !modelIdentity.modelRevision.isEmpty else {
            throw NativeLatentChannelError.invalidIdentity
        }
        let values = output.embedding
        guard output.shape == [values.count],
              !values.isEmpty,
              values.count <= Self.maximumElements,
              values.allSatisfy(\.isFinite) else {
            throw NativeLatentChannelError.invalidShape
        }

        var minimum = Float.greatestFiniteMagnitude
        var maximum = -Float.greatestFiniteMagnitude
        for value in values {
            minimum = Swift.min(minimum, value)
            maximum = Swift.max(maximum, value)
        }

        var data = Data()
        data.reserveCapacity(8 + values.count)
        appendFloat32(minimum, to: &data)
        appendFloat32(maximum, to: &data)

        // Use Double for the intermediate range so opposite-sign Float32
        // extrema cannot overflow during subtraction.
        let halfRange = Double(maximum) * 0.5 - Double(minimum) * 0.5
        for value in values {
            let normalized = halfRange == 0
                ? 0
                : (Double(value) * 0.5 - Double(minimum) * 0.5) / halfRange
            let quantized = halfRange == 0 ? 0 : Int((normalized * 254 - 127).rounded())
            data.append(UInt8(bitPattern: Int8(clamping: quantized)))
        }
        return data
    }

    public func decode(_ data: Data, shape: [Int], modelIdentity: NativeLatentModelIdentity) throws -> [Float] {
        guard modelIdentity == self.modelIdentity else {
            throw NativeLatentChannelError.invalidIdentity
        }
        guard shape.count == 1,
              let count = shape.first,
              count > 0,
              count <= Self.maximumElements,
              data.count == 8 + count else {
            throw NativeLatentChannelError.invalidShape
        }
        let minimum = readFloat32(data, at: 0)
        let maximum = readFloat32(data, at: 4)
        guard minimum.isFinite, maximum.isFinite, maximum >= minimum else {
            throw NativeLatentChannelError.invalidShape
        }

        var values: [Float] = []
        values.reserveCapacity(count)
        for index in 0..<count {
            let quantized = Int(Int8(bitPattern: data[8 + index]))
            let normalized = Double(quantized + 127) / 254
            let reconstructed = maximum == minimum
                ? Double(minimum)
                : Double(minimum) * (1 - normalized) + Double(maximum) * normalized
            let value = Float(reconstructed)
            guard value.isFinite else { throw NativeLatentChannelError.invalidDecodedVector }
            values.append(value)
        }
        return values
    }

    private func appendFloat32(_ value: Float, to data: inout Data) {
        var bits = value.bitPattern.littleEndian
        withUnsafeBytes(of: &bits) { data.append(contentsOf: $0) }
    }

    private func readFloat32(_ data: Data, at offset: Int) -> Float {
        let bits = UInt32(data[offset])
            | (UInt32(data[offset + 1]) << 8)
            | (UInt32(data[offset + 2]) << 16)
            | (UInt32(data[offset + 3]) << 24)
        return Float(bitPattern: bits)
    }
}

/// In-process channel orchestration. Production hosts must inject durable,
/// access-controlled blob storage, persistent replay protection, and an
/// APEX/Director-backed authorization adapter.
public actor NativeLatentChannel {
    private let localAgentId: String
    private let modelIdentity: NativeLatentModelIdentity
    private let codec: AffineInt8NativeLatentCodec
    private let blobStore: any NativeLatentBlobStore
    private let authorization: any NativeLatentAuthorization
    private let replayGuard: any NativeLatentReplayGuard
    private let now: @Sendable () -> Date

    public init(
        localAgentId: String,
        modelIdentity: NativeLatentModelIdentity,
        blobStore: any NativeLatentBlobStore,
        authorization: any NativeLatentAuthorization,
        replayGuard: any NativeLatentReplayGuard,
        now: @escaping @Sendable () -> Date = Date.init
    ) {
        self.localAgentId = localAgentId
        self.modelIdentity = modelIdentity
        self.codec = AffineInt8NativeLatentCodec(modelIdentity: modelIdentity)
        self.blobStore = blobStore
        self.authorization = authorization
        self.replayGuard = replayGuard
        self.now = now
    }

    public func send(
        output: LlamaLatentOutput,
        taskId: String,
        conversationId: String,
        recipientAgentId: String,
        sequence: UInt64,
        expiresAt: Date
    ) async throws -> NativeLatentTransferEnvelope {
        let createdAt = now()
        guard validIdentifier(taskId, maximum: 256),
              validIdentifier(conversationId, maximum: 256),
              validIdentifier(localAgentId, maximum: 128),
              validIdentifier(recipientAgentId, maximum: 128),
              validIdentifier(modelIdentity.modelId, maximum: 256),
              validIdentifier(modelIdentity.modelRevision, maximum: 256),
              localAgentId != recipientAgentId else {
            throw NativeLatentChannelError.invalidRoute
        }
        guard expiresAt > createdAt else { throw NativeLatentChannelError.invalidExpiry }
        guard output.modelId == modelIdentity.modelId else { throw NativeLatentChannelError.invalidIdentity }

        let selection = NativeLatentCodecSelection(
            codecId: AffineInt8NativeLatentCodec.codecId,
            codecVersion: AffineInt8NativeLatentCodec.codecVersion,
            encoderModel: modelIdentity,
            decoderModel: modelIdentity,
            dtype: .int8,
            maxPayloadBytes: AffineInt8NativeLatentCodec.maximumPayloadBytes
        )
        let bytes = try codec.encode(output)
        guard bytes.count <= selection.maxPayloadBytes else {
            throw NativeLatentChannelError.invalidShape
        }
        guard await authorization.authorize(
            taskId: taskId,
            conversationId: conversationId,
            senderAgentId: localAgentId,
            recipientAgentId: recipientAgentId,
            codec: selection,
            payloadByteCount: bytes.count
        ) else {
            throw NativeLatentChannelError.authorizationDenied
        }

        let digest = NativeLatentSHA256.digest(bytes)
        let payload = try await blobStore.put(bytes, expiresAt: expiresAt)
        guard payload.byteLength == bytes.count,
              payload.sha256.lowercased() == digest,
              validIdentifier(payload.blobRef, maximum: 1024) else {
            throw NativeLatentChannelError.invalidBlobReceipt
        }

        return NativeLatentTransferEnvelope(
            protocolVersion: 1,
            transferId: UUID(),
            taskId: taskId,
            conversationId: conversationId,
            senderAgentId: localAgentId,
            recipientAgentId: recipientAgentId,
            sequence: sequence,
            createdAt: iso8601(createdAt),
            expiresAt: iso8601(expiresAt),
            codec: selection,
            shape: output.shape,
            payload: payload
        )
    }

    public func receive(
        _ envelope: NativeLatentTransferEnvelope,
        expectedTaskId: String,
        expectedConversationId: String,
        expectedSenderAgentId: String
    ) async throws -> NativeLatentReceived {
        let current = now()
        guard envelope.protocolVersion == 1,
              validIdentifier(envelope.taskId, maximum: 256),
              validIdentifier(envelope.conversationId, maximum: 256),
              validIdentifier(envelope.senderAgentId, maximum: 128),
              validIdentifier(envelope.recipientAgentId, maximum: 128),
              validIdentifier(envelope.codec.encoderModel.modelId, maximum: 256),
              validIdentifier(envelope.codec.encoderModel.modelRevision, maximum: 256),
              validIdentifier(envelope.codec.decoderModel.modelId, maximum: 256),
              validIdentifier(envelope.codec.decoderModel.modelRevision, maximum: 256),
              envelope.taskId == expectedTaskId,
              envelope.conversationId == expectedConversationId,
              envelope.senderAgentId == expectedSenderAgentId,
              envelope.recipientAgentId == localAgentId,
              envelope.codec.encoderModel == modelIdentity,
              envelope.codec.decoderModel == modelIdentity else {
            throw NativeLatentChannelError.invalidRoute
        }
        guard let createdAt = parseISO8601(envelope.createdAt),
              let expiresAt = parseISO8601(envelope.expiresAt),
              createdAt <= current,
              createdAt < expiresAt,
              expiresAt > current else {
            throw NativeLatentChannelError.invalidExpiry
        }
        guard envelope.codec.codecId == AffineInt8NativeLatentCodec.codecId,
              envelope.codec.codecVersion == AffineInt8NativeLatentCodec.codecVersion,
              envelope.codec.dtype == .int8,
              envelope.codec.maxPayloadBytes > 0,
              envelope.codec.maxPayloadBytes <= AffineInt8NativeLatentCodec.maximumPayloadBytes else {
            throw NativeLatentChannelError.unsupportedCodec
        }
        guard envelope.shape.count == 1,
              let count = envelope.shape.first,
              count > 0,
              count <= AffineInt8NativeLatentCodec.maximumElements,
              envelope.payload.byteLength == count + 8,
              envelope.payload.byteLength <= envelope.codec.maxPayloadBytes,
              envelope.payload.sha256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            throw NativeLatentChannelError.invalidShape
        }
        guard await authorization.authorize(
            taskId: envelope.taskId,
            conversationId: envelope.conversationId,
            senderAgentId: envelope.senderAgentId,
            recipientAgentId: envelope.recipientAgentId,
            codec: envelope.codec,
            payloadByteCount: envelope.payload.byteLength
        ) else {
            throw NativeLatentChannelError.authorizationDenied
        }

        guard let bytes = try await blobStore.get(envelope.payload.blobRef) else {
            throw NativeLatentChannelError.missingBlob
        }
        guard bytes.count == envelope.payload.byteLength else {
            throw NativeLatentChannelError.payloadLengthMismatch
        }
        guard NativeLatentSHA256.digest(bytes) == envelope.payload.sha256 else {
            throw NativeLatentChannelError.payloadDigestMismatch
        }

        let replayKey = try replayKey(for: envelope)
        guard await replayGuard.claim(replayKey, expiresAt: expiresAt) else {
            throw NativeLatentChannelError.replayRejected
        }
        let embedding = try codec.decode(bytes, shape: envelope.shape, modelIdentity: envelope.codec.decoderModel)
        guard embedding.count == count, embedding.allSatisfy(\.isFinite) else {
            throw NativeLatentChannelError.invalidDecodedVector
        }
        return NativeLatentReceived(
            transferId: envelope.transferId,
            senderAgentId: envelope.senderAgentId,
            modelIdentity: modelIdentity,
            shape: envelope.shape,
            embedding: embedding
        )
    }

    private func replayKey(for envelope: NativeLatentTransferEnvelope) throws -> String {
        let components = [
            envelope.taskId, envelope.conversationId, envelope.senderAgentId,
            envelope.recipientAgentId, String(envelope.sequence)
        ]
        let data = try JSONEncoder().encode(components)
        return data.base64EncodedString()
    }

    private func validIdentifier(_ value: String, maximum: Int) -> Bool {
        !value.isEmpty && value.utf8.count <= maximum && !value.contains("\0")
    }

    private func iso8601(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func parseISO8601(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value)
            ?? ISO8601DateFormatter().date(from: value)
    }
}

public actor InMemoryNativeLatentBlobStore: NativeLatentBlobStore {
    private struct Entry {
        let data: Data
        let expiresAt: Date
    }
    private var entries: [String: Entry] = [:]
    private let now: @Sendable () -> Date

    public init(now: @escaping @Sendable () -> Date = Date.init) {
        self.now = now
    }

    public func put(_ data: Data, expiresAt: Date) async throws -> NativeLatentPayloadReference {
        guard !data.isEmpty, expiresAt > now() else {
            throw NativeLatentChannelError.invalidExpiry
        }
        let blobRef = "memory:" + UUID().uuidString
        entries[blobRef] = Entry(data: Data(data), expiresAt: expiresAt)
        return NativeLatentPayloadReference(
            blobRef: blobRef,
            byteLength: data.count,
            sha256: NativeLatentSHA256.digest(data)
        )
    }

    public func get(_ reference: String) async throws -> Data? {
        guard let entry = entries[reference] else { return nil }
        guard entry.expiresAt > now() else {
            entries[reference] = nil
            return nil
        }
        return Data(entry.data)
    }

    public func count() -> Int {
        entries.count
    }
}

public actor InMemoryNativeLatentReplayGuard: NativeLatentReplayGuard {
    private var claims: [String: Date] = [:]
    private let now: @Sendable () -> Date

    public init(now: @escaping @Sendable () -> Date = Date.init) {
        self.now = now
    }

    public func claim(_ key: String, expiresAt: Date) async -> Bool {
        let current = now()
        claims = claims.filter { $0.value > current }
        guard expiresAt > current, claims[key] == nil else { return false }
        claims[key] = expiresAt
        return true
    }
}

public struct StaticNativeLatentAuthorization: NativeLatentAuthorization {
    public let allowed: Bool
    public init(allowed: Bool) { self.allowed = allowed }

    public func authorize(
        taskId: String,
        conversationId: String,
        senderAgentId: String,
        recipientAgentId: String,
        codec: NativeLatentCodecSelection,
        payloadByteCount: Int
    ) async -> Bool {
        allowed
    }
}

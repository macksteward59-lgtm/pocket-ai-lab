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

public struct NativeLatentTransferEnvelope: Codable, Sendable, Equatable {
    public let protocolVersion: Int
    public let transferId: UUID
    public let taskId: String
    public let conversationId: String
    public let senderAgentId: String
    public let recipientAgentId: String
    public let sequence: UInt64
    public let createdAt: Date
    public let expiresAt: Date
    public let modelIdentity: NativeLatentModelIdentity
    public let codecId: String
    public let codecVersion: String
    public let shape: [Int]
    public let blobReference: String
    public let payloadByteLength: Int
    public let payloadSHA256: String
}

public struct NativeLatentReceived: Sendable, Equatable {
    public let transferId: UUID
    public let senderAgentId: String
    public let modelIdentity: NativeLatentModelIdentity
    public let shape: [Int]
    public let embedding: [Float]
}

public struct NativeLatentBlobReceipt: Sendable, Equatable {
    public let reference: String
    public let byteLength: Int
    public let sha256: String
}

public protocol NativeLatentBlobStore: Sendable {
    func put(_ data: Data, expiresAt: Date) async throws -> NativeLatentBlobReceipt
    func get(_ reference: String) async throws -> Data?
}

public protocol NativeLatentAuthorization: Sendable {
    func authorize(
        taskId: String,
        conversationId: String,
        senderAgentId: String,
        recipientAgentId: String,
        modelIdentity: NativeLatentModelIdentity,
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

        let bytes = try codec.encode(output)
        guard bytes.count <= AffineInt8NativeLatentCodec.maximumPayloadBytes else {
            throw NativeLatentChannelError.invalidShape
        }
        guard await authorization.authorize(
            taskId: taskId,
            conversationId: conversationId,
            senderAgentId: localAgentId,
            recipientAgentId: recipientAgentId,
            modelIdentity: modelIdentity,
            payloadByteCount: bytes.count
        ) else {
            throw NativeLatentChannelError.authorizationDenied
        }

        let digest = NativeLatentSHA256.digest(bytes)
        let receipt = try await blobStore.put(bytes, expiresAt: expiresAt)
        guard receipt.byteLength == bytes.count,
              receipt.sha256.lowercased() == digest,
              validIdentifier(receipt.reference, maximum: 1024) else {
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
            createdAt: createdAt,
            expiresAt: expiresAt,
            modelIdentity: modelIdentity,
            codecId: AffineInt8NativeLatentCodec.codecId,
            codecVersion: AffineInt8NativeLatentCodec.codecVersion,
            shape: output.shape,
            blobReference: receipt.reference,
            payloadByteLength: receipt.byteLength,
            payloadSHA256: receipt.sha256.lowercased()
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
              validIdentifier(envelope.modelIdentity.modelId, maximum: 256),
              validIdentifier(envelope.modelIdentity.modelRevision, maximum: 256),
              envelope.taskId == expectedTaskId,
              envelope.conversationId == expectedConversationId,
              envelope.senderAgentId == expectedSenderAgentId,
              envelope.recipientAgentId == localAgentId,
              envelope.modelIdentity == modelIdentity else {
            throw NativeLatentChannelError.invalidRoute
        }
        guard envelope.createdAt <= current,
              envelope.createdAt < envelope.expiresAt,
              envelope.expiresAt > current else {
            throw NativeLatentChannelError.invalidExpiry
        }
        guard envelope.codecId == AffineInt8NativeLatentCodec.codecId,
              envelope.codecVersion == AffineInt8NativeLatentCodec.codecVersion else {
            throw NativeLatentChannelError.unsupportedCodec
        }
        guard envelope.shape.count == 1,
              let count = envelope.shape.first,
              count > 0,
              count <= AffineInt8NativeLatentCodec.maximumElements,
              envelope.payloadByteLength == count + 8,
              envelope.payloadByteLength <= AffineInt8NativeLatentCodec.maximumPayloadBytes,
              envelope.payloadSHA256.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            throw NativeLatentChannelError.invalidShape
        }
        guard await authorization.authorize(
            taskId: envelope.taskId,
            conversationId: envelope.conversationId,
            senderAgentId: envelope.senderAgentId,
            recipientAgentId: envelope.recipientAgentId,
            modelIdentity: envelope.modelIdentity,
            payloadByteCount: envelope.payloadByteLength
        ) else {
            throw NativeLatentChannelError.authorizationDenied
        }

        guard let bytes = try await blobStore.get(envelope.blobReference) else {
            throw NativeLatentChannelError.missingBlob
        }
        guard bytes.count == envelope.payloadByteLength else {
            throw NativeLatentChannelError.payloadLengthMismatch
        }
        guard NativeLatentSHA256.digest(bytes) == envelope.payloadSHA256 else {
            throw NativeLatentChannelError.payloadDigestMismatch
        }

        let replayKey = try replayKey(for: envelope)
        guard await replayGuard.claim(replayKey, expiresAt: envelope.expiresAt) else {
            throw NativeLatentChannelError.replayRejected
        }
        let embedding = try codec.decode(bytes, shape: envelope.shape, modelIdentity: envelope.modelIdentity)
        guard embedding.count == count, embedding.allSatisfy(\.isFinite) else {
            throw NativeLatentChannelError.invalidDecodedVector
        }
        return NativeLatentReceived(
            transferId: envelope.transferId,
            senderAgentId: envelope.senderAgentId,
            modelIdentity: envelope.modelIdentity,
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

    public func put(_ data: Data, expiresAt: Date) async throws -> NativeLatentBlobReceipt {
        guard !data.isEmpty, expiresAt > now() else {
            throw NativeLatentChannelError.invalidExpiry
        }
        let reference = "memory:" + UUID().uuidString
        entries[reference] = Entry(data: Data(data), expiresAt: expiresAt)
        return NativeLatentBlobReceipt(
            reference: reference,
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
        modelIdentity: NativeLatentModelIdentity,
        payloadByteCount: Int
    ) async -> Bool {
        allowed
    }
}

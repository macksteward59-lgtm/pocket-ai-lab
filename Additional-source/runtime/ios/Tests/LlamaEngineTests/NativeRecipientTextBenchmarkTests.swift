import CryptoKit
import Foundation
import XCTest
@testable import PocketLlamaEngine

/// Real pinned-GGUF execution. Passing means the frozen measurement completed,
/// not that the model achieved a minimum answer-quality score.
final class NativeRecipientTextBenchmarkTests: XCTestCase {
    private static let modelSHA256 = "2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d"

    func testPinnedGgufFrozenRecipientTextBenchmark() async throws {
        guard let path = SmokePath.path else {
            if SmokePath.required {
                XCTFail("The required benchmark GGUF path is missing.")
            }
            throw XCTSkip("No smoke GGUF path is configured for this run.")
        }
        guard FileManager.default.isReadableFile(atPath: path) else {
            if SmokePath.required {
                XCTFail("The required benchmark GGUF is not readable.")
            }
            throw XCTSkip("Smoke GGUF is not readable in this process.")
        }

        let modelURL = URL(fileURLWithPath: path)
        let digest = try Self.sha256(fileAt: modelURL)
        // Verify bytes before load as well as the runner's pre/post hashes.
        guard digest == Self.modelSHA256 else {
            XCTFail("Benchmark GGUF does not match the repository pin.")
            return
        }
        let model = ModelDescriptor(
            id: "sha256-\(digest)",
            name: "Pinned recipient text benchmark GGUF",
            path: modelURL.path,
            contextLength: 512,
            quantization: "Q4_K_M"
        )
        let engine = LlamaCppMetalBackend(requireMetal: false)
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
            let loadedReport = await engine.offloadReport(sessionId: lease.session.id)
            let report = try XCTUnwrap(loadedReport)
            let offload = RecipientTextOffloadRecord(report: report)
            let probe = LlamaCppMetalBackend.probe()
            XCTAssertEqual(runtime.providerKind, .llamaCpp)
            XCTAssertEqual(report.requestedGpuLayers, 0)
            XCTAssertEqual(NativeRecipientTextBenchmark.manifestSHA256,
                           NativeRecipientTextBenchmark.expectedManifestSHA256)

            try Self.emit("POCKET_RECIPIENT_TEXT_START", RecipientTextStartRecord(
                suiteID: NativeRecipientTextBenchmark.suiteID,
                suiteVersion: NativeRecipientTextBenchmark.suiteVersion,
                manifestSHA256: NativeRecipientTextBenchmark.manifestSHA256,
                manifestASCII: String(decoding: NativeRecipientTextBenchmark.manifestData, as: UTF8.self),
                modelId: model.id,
                modelArtifactSHA256: digest,
                providerKind: runtime.providerKind.rawValue,
                executionSetting: "cpu-requested",
                contextLength: model.contextLength,
                maxTokens: NativeRecipientTextBenchmark.maxTokens,
                temperature: NativeRecipientTextBenchmark.temperature,
                maxOutputBytes: NativeRecipientTextBenchmark.maxOutputBytes,
                maximumDurationSeconds: NativeRecipientTextBenchmark.maximumDurationSeconds,
                llamaCppPinTag: probe.pinTag,
                llamaCppPinCommit: probe.pinCommit,
                offload: offload
            ))

            let run = try await NativeRecipientTextBenchmark.run(
                runtime: runtime,
                lease: lease,
                expectedModelSHA256: digest,
                onTrial: { trial in
                    do {
                        try Self.emit("POCKET_RECIPIENT_TEXT_TRIAL", RecipientTextTrialRecord(
                            manifestSHA256: NativeRecipientTextBenchmark.expectedManifestSHA256,
                            modelArtifactSHA256: digest,
                            trial: trial
                        ))
                    } catch {
                        XCTFail("Could not encode a benchmark trial: \(error)")
                    }
                }
            )

            let afterGeneration = await runtime.snapshot()
            let generationScheduler = await runtime.schedulerSnapshot()
            let released = await runtime.release(lease)
            try await runtime.unload(modelId: model.id)
            let afterUnload = await runtime.snapshot()
            let finalScheduler = await runtime.schedulerSnapshot()
            let cleanup = RecipientTextCleanupRecord(
                leaseReleased: released,
                activeLeaseCountBeforeRelease: afterGeneration.activeLeaseCount,
                activeUseCountBeforeRelease: afterGeneration.activeUseCount,
                activeRequestsBeforeRelease: generationScheduler.activeRequests,
                waitingRequestsBeforeRelease: generationScheduler.waitingRequests,
                activeLeaseCount: afterUnload.activeLeaseCount,
                activeUseCount: afterUnload.activeUseCount,
                loadedModelIDs: afterUnload.loadedModelIDs,
                pendingModelIDs: afterUnload.pendingModelIDs,
                unloadingModelIDs: afterUnload.unloadingModelIDs,
                reservedMemoryMB: afterUnload.reservedMemoryMB,
                activeRequests: finalScheduler.activeRequests,
                waitingRequests: finalScheduler.waitingRequests
            )
            try Self.emit("POCKET_RECIPIENT_TEXT_SUMMARY", RecipientTextSummaryRecord(
                executionSetting: "cpu-requested", offload: offload, run: run, cleanup: cleanup
            ))

            XCTAssertEqual(run.providerKind, "llamaCpp")
            XCTAssertEqual(run.modelArtifactSHA256, Self.modelSHA256)
            XCTAssertEqual(run.manifestSHA256, NativeRecipientTextBenchmark.expectedManifestSHA256)
            XCTAssertEqual(run.status, .completed)
            XCTAssertEqual(run.trials.count, 36)
            XCTAssertEqual(run.metrics.caseCount, 12)
            XCTAssertEqual(run.metrics.attemptedTrialCount, 36)
            XCTAssertEqual(run.metrics.completedTrialCount, 36)
            XCTAssertEqual(run.metrics.generationFailedCount, 0)
            XCTAssertEqual(run.metrics.notRunBudgetCount, 0)
            XCTAssertEqual(Set(run.trials.compactMap(\.requestId)).count, 36)
            XCTAssertEqual(afterGeneration.activeLeaseCount, 1)
            XCTAssertEqual(afterGeneration.activeUseCount, 0)
            XCTAssertEqual(generationScheduler.activeRequests, 0)
            XCTAssertEqual(generationScheduler.waitingRequests, 0)
            XCTAssertTrue(released)
            XCTAssertEqual(afterUnload.activeLeaseCount, 0)
            XCTAssertEqual(afterUnload.activeUseCount, 0)
            XCTAssertTrue(afterUnload.loadedModelIDs.isEmpty)
            XCTAssertTrue(afterUnload.pendingModelIDs.isEmpty)
            XCTAssertTrue(afterUnload.unloadingModelIDs.isEmpty)
            XCTAssertEqual(afterUnload.reservedMemoryMB, 0)
            XCTAssertEqual(finalScheduler.activeRequests, 0)
            XCTAssertEqual(finalScheduler.waitingRequests, 0)
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

    private static func emit<T: Encodable>(_ marker: String, _ value: T) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        var line = Data((marker + " ").utf8)
        line.append(try encoder.encode(value))
        line.append(0x0A)
        // Write each completed row immediately; a later timeout must not hide it.
        FileHandle.standardOutput.write(line)
    }
}

private struct RecipientTextOffloadRecord: Encodable {
    let metalDeviceUsableAtLoad: Bool
    let requestedGpuLayers: Int
    let offloadedLayers: Int
    let reportedLayerCount: Int

    init(report: LlamaOffloadReport) {
        metalDeviceUsableAtLoad = report.metalDeviceUsableAtLoad
        requestedGpuLayers = report.requestedGpuLayers
        offloadedLayers = report.offloadedLayers
        reportedLayerCount = report.reportedLayerCount
    }
}

private struct RecipientTextStartRecord: Encodable {
    let suiteID: String
    let suiteVersion: String
    let manifestSHA256: String
    let manifestASCII: String
    let modelId: String
    let modelArtifactSHA256: String
    let providerKind: String
    let executionSetting: String
    let contextLength: Int
    let maxTokens: Int
    let temperature: Double
    let maxOutputBytes: Int
    let maximumDurationSeconds: Int
    let llamaCppPinTag: String
    let llamaCppPinCommit: String
    let offload: RecipientTextOffloadRecord
}

private struct RecipientTextTrialRecord: Encodable {
    let manifestSHA256: String
    let modelArtifactSHA256: String
    let trial: NativeRecipientTextTrial
}

private struct RecipientTextCleanupRecord: Encodable {
    let leaseReleased: Bool
    let activeLeaseCountBeforeRelease: Int
    let activeUseCountBeforeRelease: Int
    let activeRequestsBeforeRelease: Int
    let waitingRequestsBeforeRelease: Int
    let activeLeaseCount: Int
    let activeUseCount: Int
    let loadedModelIDs: [String]
    let pendingModelIDs: [String]
    let unloadingModelIDs: [String]
    let reservedMemoryMB: Int
    let activeRequests: Int
    let waitingRequests: Int
}

private struct RecipientTextSummaryRecord: Encodable {
    let executionSetting: String
    let offload: RecipientTextOffloadRecord
    let run: NativeRecipientTextBenchmarkRun
    let cleanup: RecipientTextCleanupRecord
}

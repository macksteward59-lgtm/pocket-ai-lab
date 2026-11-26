import Foundation
import XCTest
@testable import PocketLlamaEngine

final class RecipientFormatCalibrationTests: XCTestCase {
    func testPinnedRecipientFormatCalibration() async throws {
        // Dedicated workflow opts in after tokenizer preflight. General native
        // regressions must not silently start an additional experiment.
        guard ProcessInfo.processInfo.environment["POCKET_RECIPIENT_FORMAT_CALIBRATION"] == "1" else {
            throw XCTSkip("The isolated recipient format calibration was not requested.")
        }
        let manifest = try RecipientFormatCalibration.loadManifest()
        let path = try XCTUnwrap(SmokePath.path, "The requested experiment requires its pinned GGUF.")
        let before = try RecipientFormatCalibration.fingerprint(path)
        guard before.sha256 == manifest.model.sha256, before.bytes == manifest.model.bytes else {
            throw NativeRecipientTextBenchmarkError.modelArtifactMismatch
        }
        let model = ModelDescriptor(id: "sha256-" + before.sha256,
                                    name: "Pinned format calibration only", path: path,
                                    contextLength: manifest.settings.contextLength, quantization: "Q4_K_M")
        let engine = LlamaCppMetalBackend(requireMetal: false)
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: ModelPoolConfiguration(maxResidentMemoryMB: 2_048, maxLoadedModels: 1, minimumFreeMemoryMB: 0),
            availableMemoryMB: { 4_096 }, maxConcurrentRequests: 1
        )
        let lease = try await runtime.acquire(model: model, estimatedMemoryMB: 512)
        do {
            let loadedReport = await engine.offloadReport(sessionId: lease.session.id)
            let report = try XCTUnwrap(loadedReport)
            let probe = LlamaCppMetalBackend.probe()
            guard runtime.providerKind == .llamaCpp, report.requestedGpuLayers == 0,
                  probe.pinTag == "b12233", probe.pinCommit == "5f490d7bfe78844e6390c869454c149fd7e003a8" else {
                throw NativeRecipientTextBenchmarkError.invalidModelIdentity
            }
            try RecipientFormatCalibration.emit("POCKET_RECIPIENT_FORMAT_START", FormatStart(
                schemaVersion: 1, manifestSHA256: RecipientFormatCalibration.manifestSHA256,
                modelArtifactSHA256: before.sha256, modelBytes: before.bytes, modelId: model.id,
                providerKind: runtime.providerKind.rawValue, contextLength: manifest.settings.contextLength,
                maxTokens: manifest.settings.maxTokens, temperature: manifest.settings.temperature,
                maxOutputBytes: manifest.settings.maxOutputBytes,
                maximumDurationSeconds: manifest.settings.maximumDurationSeconds,
                llamaCppPinTag: probe.pinTag, llamaCppPinCommit: probe.pinCommit,
                offload: FormatOffload(report)
            ))
            let run = try await RecipientFormatCalibration.run(
                runtime: runtime, lease: lease, expectedModelSHA256: before.sha256,
                onTrial: { try RecipientFormatCalibration.emit("POCKET_RECIPIENT_FORMAT_TRIAL", $0) }
            )
            let beforeRelease = await runtime.snapshot()
            let schedulerBefore = await runtime.schedulerSnapshot()
            let released = await runtime.release(lease)
            try await runtime.unload(modelId: model.id)
            let afterUnload = await runtime.snapshot()
            let schedulerAfter = await runtime.schedulerSnapshot()
            let cleanup = FormatCleanup(
                leaseReleased: released, activeLeaseCountBeforeRelease: beforeRelease.activeLeaseCount,
                activeUseCountBeforeRelease: beforeRelease.activeUseCount,
                activeRequestsBeforeRelease: schedulerBefore.activeRequests,
                waitingRequestsBeforeRelease: schedulerBefore.waitingRequests,
                activeLeaseCount: afterUnload.activeLeaseCount, activeUseCount: afterUnload.activeUseCount,
                loadedModelIDs: afterUnload.loadedModelIDs, pendingModelIDs: afterUnload.pendingModelIDs,
                unloadingModelIDs: afterUnload.unloadingModelIDs, reservedMemoryMB: afterUnload.reservedMemoryMB,
                activeRequests: schedulerAfter.activeRequests, waitingRequests: schedulerAfter.waitingRequests
            )
            try RecipientFormatCalibration.emit("POCKET_RECIPIENT_FORMAT_SUMMARY", FormatSummary(
                manifestSHA256: RecipientFormatCalibration.manifestSHA256, status: run.status,
                elapsedMilliseconds: run.elapsedMilliseconds,
                modelArtifactSHA256After: run.modelArtifactSHA256After, modelBytesAfter: run.modelBytesAfter,
                trials: run.trials, cleanup: cleanup
            ))
            // This is measurement completeness, with failures retained as data.
            // The independent chat-format gate remains a separate failing step.
            XCTAssertEqual(run.status, "completed")
            XCTAssertEqual(run.trials.count, 72)
            XCTAssertEqual(run.trials.filter { $0.status == "notRunBudget" }.count, 0)
            XCTAssertEqual(Set(run.trials.compactMap(\.requestId)).count, 72)
            XCTAssertEqual(beforeRelease.activeLeaseCount, 1)
            XCTAssertEqual(beforeRelease.activeUseCount, 0)
            XCTAssertEqual(schedulerBefore.activeRequests, 0)
            XCTAssertEqual(schedulerBefore.waitingRequests, 0)
            XCTAssertTrue(released)
            XCTAssertEqual(afterUnload.activeLeaseCount, 0)
            XCTAssertEqual(afterUnload.activeUseCount, 0)
            XCTAssertTrue(afterUnload.loadedModelIDs.isEmpty)
            XCTAssertTrue(afterUnload.pendingModelIDs.isEmpty)
            XCTAssertTrue(afterUnload.unloadingModelIDs.isEmpty)
            XCTAssertEqual(afterUnload.reservedMemoryMB, 0)
            XCTAssertEqual(schedulerAfter.activeRequests, 0)
            XCTAssertEqual(schedulerAfter.waitingRequests, 0)
        } catch {
            _ = await runtime.release(lease)
            try? await runtime.unload(modelId: model.id)
            throw error
        }
    }
}

private struct FormatOffload: Encodable {
    let metalDeviceUsableAtLoad: Bool
    let requestedGpuLayers: Int
    let offloadedLayers: Int
    let reportedLayerCount: Int
    init(_ report: LlamaOffloadReport) {
        metalDeviceUsableAtLoad = report.metalDeviceUsableAtLoad
        requestedGpuLayers = report.requestedGpuLayers
        offloadedLayers = report.offloadedLayers
        reportedLayerCount = report.reportedLayerCount
    }
}

private struct FormatStart: Encodable {
    let schemaVersion: Int
    let manifestSHA256: String
    let modelArtifactSHA256: String
    let modelBytes: Int
    let modelId: String
    let providerKind: String
    let contextLength: Int
    let maxTokens: Int
    let temperature: Double
    let maxOutputBytes: Int
    let maximumDurationSeconds: Int
    let llamaCppPinTag: String
    let llamaCppPinCommit: String
    let offload: FormatOffload
}

private struct FormatCleanup: Encodable {
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

private struct FormatSummary: Encodable {
    let manifestSHA256: String
    let status: String
    let elapsedMilliseconds: Int
    let modelArtifactSHA256After: String
    let modelBytesAfter: Int
    let trials: [RecipientFormatTrial]
    let cleanup: FormatCleanup
}

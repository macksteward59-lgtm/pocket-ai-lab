import Dispatch
import Foundation
import XCTest
@testable import PocketLlamaEngine

final class DeepSeekQualificationTests: XCTestCase {
    func testPinnedDeepSeekQualification() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["POCKET_DEEPSEEK_QUALIFICATION"] == "1" else {
            throw XCTSkip("The separate DeepSeek qualification was not requested.")
        }
        let profilePath = try XCTUnwrap(environment["POCKET_DEEPSEEK_PROFILE"], "An absolute qualification profile path is required.")
        let path = try XCTUnwrap(environment["POCKET_DEEPSEEK_MODEL"], "The exact pinned model path is required.")
        guard path.hasPrefix("/") else { throw DeepSeekQualificationError.invalidModelArtifact }
        let loaded = try DeepSeekQualification.loadProfile(at: profilePath)
        let profile = loaded.profile
        try DeepSeekQualification.requirePinnedModel(profile)
        let before = try DeepSeekQualification.fingerprint(path, expectedBytes: profile.model.bytes)
        guard before.sha256 == profile.model.sha256 else { throw DeepSeekQualificationError.modelArtifactMismatch }
        let metadata = try GGUFMetadataInspector.inspect(at: URL(fileURLWithPath: path))
        guard metadata.architecture == "qwen2", metadata.tokenizerModel == "gpt2",
              metadata.fileType == 15, metadata.fileSizeBytes == UInt64(profile.model.bytes) else {
            throw DeepSeekQualificationError.invalidModelArtifact
        }
        let model = ModelDescriptor(id: "sha256-" + before.sha256, name: "Pinned DeepSeek qualification only",
                                    path: path, contextLength: profile.settings.contextLength, quantization: "Q4_K_M")
        let engine = LlamaCppMetalBackend(requireMetal: false)
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: ModelPoolConfiguration(maxResidentMemoryMB: 4_096, maxLoadedModels: 1, minimumFreeMemoryMB: 0),
            // A declared experiment admission allowance, not a free-RAM measurement.
            // Actual inference-process high-water RSS is recorded independently.
            availableMemoryMB: { 4_096 }, maxConcurrentRequests: 1
        )
        let totalStarted = DispatchTime.now().uptimeNanoseconds
        let loadStarted = DispatchTime.now().uptimeNanoseconds
        let lease = try await runtime.acquire(model: model, estimatedMemoryMB: 1_600)
        let loadLatency = DeepSeekQualification.milliseconds(try DeepSeekQualification.elapsed(loadStarted, DispatchTime.now().uptimeNanoseconds))
        var cleaned = false
        do {
            let loadedOffload = await engine.offloadReport(sessionId: lease.session.id)
            let offload = try XCTUnwrap(loadedOffload)
            let probe = LlamaCppMetalBackend.probe()
            guard runtime.providerKind == .llamaCpp, offload.requestedGpuLayers == 0,
                  probe.pinTag == profile.runtime.tag, probe.pinCommit == profile.runtime.commit else {
                throw DeepSeekQualificationError.invalidModelIdentity
            }
            try DeepSeekQualification.emitObject("POCKET_DEEPSEEK_START", [
                "schemaVersion": 1, "profileID": profile.id, "profileSHA256": loaded.sha256, "profileBytes": loaded.byteCount,
                "modelID": model.id, "modelArtifactSHA256": before.sha256, "modelBytes": before.bytes,
                "providerKind": runtime.providerKind.rawValue, "contextLength": profile.settings.contextLength,
                "maxTokens": profile.settings.maxTokens, "temperature": profile.settings.temperature,
                "maxOutputBytes": profile.settings.maxOutputBytes, "maximumDurationSeconds": profile.settings.maximumDurationSeconds,
                "llamaCppPinTag": probe.pinTag, "llamaCppPinCommit": probe.pinCommit,
                "offload": ["metalDeviceUsableAtLoad": offload.metalDeviceUsableAtLoad,
                            "requestedGpuLayers": offload.requestedGpuLayers, "offloadedLayers": offload.offloadedLayers,
                            "reportedLayerCount": offload.reportedLayerCount] as [String: Any],
                "loadLatencyMilliseconds": loadLatency,
                "processPeakRSSBytes": DeepSeekQualification.processPeakRSSBytes().map { $0 as Any } ?? NSNull(),
                "processPeakRSSMethod": DeepSeekQualification.rssMethod, "processPeakRSSScope": DeepSeekQualification.rssScope,
                "finishReason": NSNull(), "tokenCount": NSNull(), "timeToFirstTokenMilliseconds": NSNull()
            ] as [String: Any])
            let run = try await DeepSeekQualification.run(runtime: runtime, lease: lease, loadedProfile: loaded,
                onTrial: { try DeepSeekQualification.emit("POCKET_DEEPSEEK_TRIAL", $0) })
            let cleanup = try await DeepSeekQualification.cleanup(runtime: runtime, lease: lease)
            cleaned = true
            let totalLatency = DeepSeekQualification.milliseconds(try DeepSeekQualification.elapsed(totalStarted, DispatchTime.now().uptimeNanoseconds))
            try DeepSeekQualification.emitObject("POCKET_DEEPSEEK_SUMMARY", [
                "schemaVersion": 1, "profileSHA256": loaded.sha256, "status": run.status,
                "loadLatencyMilliseconds": loadLatency, "elapsedMilliseconds": run.elapsedMilliseconds,
                "totalLatencyMilliseconds": totalLatency, "modelArtifactSHA256After": run.modelArtifactSHA256After,
                "modelBytesAfter": run.modelBytesAfter,
                "processPeakRSSBytes": DeepSeekQualification.processPeakRSSBytes().map { $0 as Any } ?? NSNull(),
                "processPeakRSSMethod": DeepSeekQualification.rssMethod, "processPeakRSSScope": DeepSeekQualification.rssScope,
                "trials": try DeepSeekQualification.jsonObject(run.trials),
                "cleanup": try DeepSeekQualification.jsonObject(cleanup)
            ] as [String: Any])
            // Integrity and complete accounting only. The independent auditor
            // separately gates eight correct, strict final JSON answers.
            XCTAssertEqual(run.status, "completed")
            XCTAssertEqual(run.trials.count, 8)
            XCTAssertEqual(Set(run.trials.compactMap(\.requestID)).count, 8)
            XCTAssertFalse(run.trials.contains { $0.status == "notRunBudget" })
            XCTAssertEqual(cleanup.activeLeaseCountBeforeRelease, 1)
            XCTAssertEqual(cleanup.activeUseCountBeforeRelease, 0)
            XCTAssertEqual(cleanup.activeRequestsBeforeRelease, 0)
            XCTAssertEqual(cleanup.waitingRequestsBeforeRelease, 0)
            XCTAssertTrue(cleanup.isClean)
        } catch {
            if !cleaned { _ = try? await DeepSeekQualification.cleanup(runtime: runtime, lease: lease) }
            throw error
        }
    }
}

import XCTest
@testable import PocketLlamaEngine

final class NativeAgentCoordinatorTests: XCTestCase {
    func testSequentialRolesProduceLinkedMessagesAndFinalResponse() async throws {
        let engine = RecordingInferenceEngine(responses: ["reasoned", "criticized", "validated"])
        let session = RuntimeSession(id: "session-1", modelId: "local-model")
        let coordinator = NativeAgentCoordinator(engine: engine, session: session)
        let task = AgentTaskRequest(id: "task-1", objective: "Review the runtime architecture",
                                    requiredCapabilities: ["reasoning", "security"])
        let steps = [
            NativeAgentStep(agentId: "reasoner", instructions: "Analyze the design."),
            NativeAgentStep(agentId: "critic", instructions: "Find weaknesses.", messageType: .counterargument),
            NativeAgentStep(agentId: "validator", instructions: "Check the conclusions.", messageType: .validation)
        ]

        let result = try await coordinator.run(task: task, conversationId: "conversation-1", steps: steps)
        XCTAssertEqual(result.messages.count, 3)
        XCTAssertEqual(result.finalResponse, "validated")
        XCTAssertEqual(result.messages[0].sequence, 0)
        XCTAssertEqual(result.messages[1].parentMessageId, result.messages[0].messageId)
        XCTAssertEqual(result.messages[2].parentMessageId, result.messages[1].messageId)
        XCTAssertEqual(result.messages[0].recipientAgentId, "critic")
        XCTAssertEqual(result.messages[2].recipientAgentId, "user")
        let prompts = await engine.recordedPrompts
        XCTAssertEqual(prompts.count, 3)
        XCTAssertTrue(prompts[1].contains("UNTRUSTED PROPOSAL FROM reasoner"))
        XCTAssertTrue(prompts[1].contains("reasoned"))
        XCTAssertTrue(prompts[2].contains("UNTRUSTED PROPOSAL FROM critic"))
        XCTAssertTrue(prompts[2].contains("criticized"))
    }

    func testEmptyPlanIsRejectedBeforeInference() async {
        let engine = RecordingInferenceEngine(responses: [])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: "Do work", requiredCapabilities: []),
                steps: []
            )
            XCTFail("empty plan should be rejected")
        } catch NativeAgentCoordinatorError.invalidPlan {
        } catch {
            XCTFail("unexpected error: \(error)")
        }
        let count = await engine.recordedPrompts.count
        XCTAssertEqual(count, 0)
    }

    func testEmptyModelOutputDoesNotProduceAgentMessage() async {
        let engine = RecordingInferenceEngine(responses: ["  "])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: "Do work", requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Analyze")]
            )
            XCTFail("empty output should fail")
        } catch NativeAgentCoordinatorError.emptyModelResponse {
        } catch {
            XCTFail("unexpected error: \(error)")
        }
    }

    func testOversizedTaskAndPlanAreRejectedBeforeInference() async {
        let engine = RecordingInferenceEngine(responses: [])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: String(repeating: "x", count: 4_001),
                    requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Analyze")]
            )
            XCTFail("oversized objective should be rejected")
        } catch NativeAgentCoordinatorError.invalidTask {
        } catch {
            XCTFail("unexpected error: \(error)")
        }

        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: String(repeating: "界", count: 1_500),
                    requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Analyze")]
            )
            XCTFail("oversized UTF-8 objective should be rejected")
        } catch NativeAgentCoordinatorError.invalidTask {
        } catch {
            XCTFail("unexpected error: \(error)")
        }

        let tooManySteps = (0..<9).map {
            NativeAgentStep(agentId: "role-\($0)", instructions: "Analyze")
        }
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: "Do work", requiredCapabilities: []),
                steps: tooManySteps
            )
            XCTFail("too many roles should be rejected")
        } catch NativeAgentCoordinatorError.invalidPlan {
        } catch {
            XCTFail("unexpected error: \(error)")
        }

        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: "Do work", requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Analyze")],
                maxTokens: 513
            )
            XCTFail("per-step token budget should be bounded")
        } catch NativeAgentCoordinatorError.invalidPlan {
        } catch {
            XCTFail("unexpected error: \(error)")
        }
        let count = await engine.recordedPrompts.count
        XCTAssertEqual(count, 0)
    }

    func testPriorRoleOutputIsTruncatedBeforeItEntersTheNextPrompt() async throws {
        let engine = RecordingInferenceEngine(responses: [
            String(repeating: "A", count: 2_000),
            "criticized"
        ])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        _ = try await coordinator.run(
            task: AgentTaskRequest(id: "t", objective: "Review this", requiredCapabilities: []),
            steps: [
                NativeAgentStep(agentId: "reasoner", instructions: "Analyze"),
                NativeAgentStep(agentId: "critic", instructions: "Challenge")
            ],
            maxTokens: 128
        )
        let prompts = await engine.recordedPrompts
        XCTAssertEqual(prompts.count, 2)
        XCTAssertTrue(prompts[1].contains("[truncated]"))
        XCTAssertLessThanOrEqual(prompts[1].count, 12_000)
    }

    func testOversizedModelResponseIsRejectedAndCancelled() async {
        let engine = RecordingInferenceEngine(responses: [String(repeating: "x", count: 8_001)])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "t", objective: "Do work", requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Analyze")]
            )
            XCTFail("oversized response should fail")
        } catch NativeAgentCoordinatorError.responseTooLarge {
        } catch {
            XCTFail("unexpected error: \(error)")
        }
        let cancellations = await engine.cancelledRequestIDs
        XCTAssertEqual(cancellations.count, 1)
    }
    func testNativeMessagesUseTheExactTypeSpecificWirePayloads() async throws {
        let engine = RecordingInferenceEngine(responses: ["analysis", "question", "objection", "revision", "validation", "synthesis"])
        let coordinator = NativeAgentCoordinator(engine: engine,
            session: RuntimeSession(id: "s", modelId: "m"))
        let result = try await coordinator.run(
            task: AgentTaskRequest(id: "wire-task", objective: "Check wire compatibility", requiredCapabilities: []),
            steps: [
                NativeAgentStep(agentId: "a", instructions: "Analyze", messageType: .analysis),
                NativeAgentStep(agentId: "b", instructions: "Ask", messageType: .question),
                NativeAgentStep(agentId: "c", instructions: "Challenge", messageType: .counterargument),
                NativeAgentStep(agentId: "d", instructions: "Revise", messageType: .revision),
                NativeAgentStep(agentId: "e", instructions: "Validate", messageType: .validation),
                NativeAgentStep(agentId: "f", instructions: "Synthesize", messageType: .completion)
            ]
        )

        XCTAssertEqual(result.messages.count, 6)
        XCTAssertEqual(result.messages[0].payload, .object(["analysis": .string("analysis")]))
        XCTAssertEqual(result.messages[1].payload, .object(["question": .string("question")]))
        XCTAssertEqual(result.messages[2].payload, .object([
            "claim": .string("Prior agent proposal"),
            "objection": .string("objection"),
            "evidenceRefs": .array([])
        ]))
        XCTAssertEqual(result.messages[3].payload, .object([
            "revision": .string("revision"),
            "addressesMessageIds": .array(result.messages.prefix(3).map {
                .string($0.messageId.uuidString.lowercased())
            })
        ]))
        XCTAssertEqual(result.messages[4].payload, .object([
            "claim": .string("Prior agent proposal"),
            "verified": .boolean(false),
            "reason": .string("validation")
        ]))
        XCTAssertEqual(result.messages[5].payload, .object([
            "synthesis": .string("synthesis"),
            "evidenceRefs": .array([])
        ]))
    }

    func testModelCannotEmitEvidenceOrTrustedSecurityBoundaryEvents() async {
        for forbidden: AgentMessageType in [.taskAssignment, .evidence, .securityBoundaryViolation] {
            let engine = RecordingInferenceEngine(responses: [])
            let coordinator = NativeAgentCoordinator(engine: engine,
                session: RuntimeSession(id: "s", modelId: "m"))
            do {
                _ = try await coordinator.run(
                    task: AgentTaskRequest(id: "task", objective: "Do work", requiredCapabilities: []),
                    steps: [NativeAgentStep(agentId: "model", instructions: "Respond", messageType: forbidden)]
                )
                XCTFail("model-generated \\(forbidden) must be rejected before inference")
            } catch NativeAgentCoordinatorError.invalidPlan {
            } catch {
                XCTFail("unexpected error: \\(error)")
            }
            let prompts = await engine.recordedPrompts
            XCTAssertTrue(prompts.isEmpty)
        }
    }

    func testMessageSinkReceivesEachCompletedRoleInSequence() async throws {
        let engine = RecordingInferenceEngine(responses: ["reasoned", "criticized"])
        let coordinator = NativeAgentCoordinator(
            engine: engine,
            session: RuntimeSession(id: "s", modelId: "m")
        )
        let recorder = AgentMessageRecorder()
        let result = try await coordinator.run(
            task: AgentTaskRequest(id: "task", objective: "Review", requiredCapabilities: []),
            steps: [
                NativeAgentStep(agentId: "reasoner", instructions: "Analyze"),
                NativeAgentStep(agentId: "critic", instructions: "Challenge")
            ],
            onMessage: { message in await recorder.record(message) }
        )

        let recorded = await recorder.messages
        XCTAssertEqual(result.messages, recorded)
        XCTAssertEqual(recorded.map(\.sequence), [0, 1])
        XCTAssertEqual(recorded.map(\.senderAgentId), ["reasoner", "critic"])
    }

    func testRejectedMessageSinkStopsBeforeTheNextRoleRuns() async {
        let engine = RecordingInferenceEngine(responses: ["reasoned", "must-not-run"])
        let coordinator = NativeAgentCoordinator(
            engine: engine,
            session: RuntimeSession(id: "s", modelId: "m")
        )
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "task", objective: "Review", requiredCapabilities: []),
                steps: [
                    NativeAgentStep(agentId: "reasoner", instructions: "Analyze"),
                    NativeAgentStep(agentId: "critic", instructions: "Challenge")
                ],
                onMessage: { _ in false }
            )
            XCTFail("rejected durable message should stop the run")
        } catch NativeAgentCoordinatorError.messageSinkRejected {
        } catch {
            XCTFail("unexpected error: \(error)")
        }
        let prompts = await engine.recordedPrompts
        XCTAssertEqual(prompts.count, 1)
    }

    func testRoutedRolesAcquireExactModelLeasesAndReleaseAfterEachGeneration() async throws {
        let engine = RoutingRecordingEngine(responses: ["reasoned", "secured"])
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(
                maxResidentMemoryMB: 2_048,
                maxLoadedModels: 2,
                minimumFreeMemoryMB: 0
            ),
            availableMemoryMB: { 4_096 }
        )
        let profiles = [
            NativeAgentModelProfile(
                model: ModelDescriptor(id: "reasoning-model", name: "Reasoning", path: "/models/reasoning.gguf", contextLength: 4_096),
                capabilities: ["reasoning"], estimatedMemoryMB: 512
            ),
            NativeAgentModelProfile(
                model: ModelDescriptor(id: "security-model", name: "Security", path: "/models/security.gguf", contextLength: 4_096),
                capabilities: ["security"], estimatedMemoryMB: 640
            )
        ]
        let coordinator = NativeAgentCoordinator(runtime: runtime, profiles: profiles)
        let result = try await coordinator.run(
            task: AgentTaskRequest(id: "routed-task", objective: "Review safely", requiredCapabilities: []),
            steps: [
                NativeAgentStep(agentId: "reasoner", instructions: "Reason", requiredCapabilities: ["reasoning"]),
                NativeAgentStep(agentId: "security-analyst", instructions: "Review security", requiredCapabilities: ["security"])
            ]
        )

        XCTAssertEqual(result.messages.map(\.senderAgentId), ["reasoner", "security-analyst"])
        let generatedModelIDs = await engine.generatedModelIDs
        let loadedModelIDs = await engine.loadedModelIDs
        XCTAssertEqual(generatedModelIDs, ["reasoning-model", "security-model"])
        XCTAssertEqual(loadedModelIDs, ["reasoning-model", "security-model"])
        let snapshot = await runtime.snapshot()
        XCTAssertEqual(snapshot.activeLeaseCount, 0)
        XCTAssertEqual(snapshot.activeUseCount, 0)
        XCTAssertEqual(snapshot.pendingAcquirerCount, 0)
    }


    func testRoutedRolesSwitchModelsWithSingleResidentPoolByEvictingOnlyIdleProfile() async throws {
        let engine = RoutingRecordingEngine(responses: ["reasoned", "secured"])
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(
                maxResidentMemoryMB: 1_024,
                maxLoadedModels: 1,
                minimumFreeMemoryMB: 0
            ),
            availableMemoryMB: { 2_048 }
        )
        let profiles = [
            NativeAgentModelProfile(
                model: ModelDescriptor(id: "reasoning-model", name: "Reasoning", path: "/models/reasoning.gguf", contextLength: 4_096),
                capabilities: ["reasoning"], estimatedMemoryMB: 512
            ),
            NativeAgentModelProfile(
                model: ModelDescriptor(id: "security-model", name: "Security", path: "/models/security.gguf", contextLength: 4_096),
                capabilities: ["security"], estimatedMemoryMB: 512
            )
        ]
        let coordinator = NativeAgentCoordinator(runtime: runtime, profiles: profiles)

        let result = try await coordinator.run(
            task: AgentTaskRequest(id: "single-resident-route", objective: "Review safely", requiredCapabilities: []),
            steps: [
                NativeAgentStep(agentId: "reasoner", instructions: "Reason", requiredCapabilities: ["reasoning"]),
                NativeAgentStep(agentId: "security-analyst", instructions: "Review", requiredCapabilities: ["security"])
            ]
        )

        XCTAssertEqual(result.messages.count, 2)
        let generated = await engine.generatedModelIDs
        let loaded = await engine.loadedModelIDs
        let unloaded = await engine.unloadedSessionIDs
        XCTAssertEqual(generated, ["reasoning-model", "security-model"])
        XCTAssertEqual(loaded, ["reasoning-model", "security-model"])
        XCTAssertEqual(unloaded, ["session-reasoning-model"])
        let snapshot = await runtime.snapshot()
        XCTAssertEqual(snapshot.loadedModelIDs, ["security-model"])
        XCTAssertEqual(snapshot.activeLeaseCount, 0)
        XCTAssertEqual(snapshot.activeUseCount, 0)
        XCTAssertEqual(snapshot.reservedMemoryMB, 512)
    }

    func testRoutedModelSwitchNeverEvictsAnotherCallersActiveLease() async throws {
        let engine = RoutingRecordingEngine(responses: ["should-not-run"])
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(
                maxResidentMemoryMB: 1_024,
                maxLoadedModels: 1,
                minimumFreeMemoryMB: 0
            ),
            availableMemoryMB: { 2_048 }
        )
        let held = try await runtime.acquire(
            model: ModelDescriptor(id: "held-model", name: "Held", path: "/models/held.gguf", contextLength: 4_096),
            estimatedMemoryMB: 512
        )
        let profile = NativeAgentModelProfile(
            model: ModelDescriptor(id: "specialist-model", name: "Specialist", path: "/models/specialist.gguf", contextLength: 4_096),
            capabilities: ["specialist"], estimatedMemoryMB: 512
        )
        let coordinator = NativeAgentCoordinator(runtime: runtime, profiles: [profile])

        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "held-lease", objective: "Do not evict", requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "specialist", instructions: "Review", requiredCapabilities: ["specialist"])]
            )
            XCTFail("a caller-owned active lease must prevent model eviction")
        } catch ModelPoolError.modelLimitExceeded {
        } catch {
            XCTFail("unexpected error: \\(error)")
        }

        let loaded = await engine.loadedModelIDs
        let generated = await engine.generatedModelIDs
        let unloaded = await engine.unloadedSessionIDs
        XCTAssertEqual(loaded, ["held-model"])
        XCTAssertTrue(generated.isEmpty)
        XCTAssertTrue(unloaded.isEmpty)
        let snapshot = await runtime.snapshot()
        XCTAssertEqual(snapshot.activeLeaseCount, 1)
        XCTAssertEqual(snapshot.loadedModelIDs, ["held-model"])
        _ = await runtime.release(held)
        try await runtime.unload(modelId: "held-model")
    }

    func testCancellationDuringRoutedModelLoadReleasesLeaseWithoutGeneration() async throws {
        let engine = BlockingLoadInferenceEngine()
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(
                maxResidentMemoryMB: 1_024,
                maxLoadedModels: 1,
                minimumFreeMemoryMB: 0
            ),
            availableMemoryMB: { 2_048 }
        )
        let profile = NativeAgentModelProfile(
            model: ModelDescriptor(id: "slow-model", name: "Slow", path: "/models/slow.gguf", contextLength: 4_096),
            capabilities: ["reasoning"], estimatedMemoryMB: 512
        )
        let coordinator = NativeAgentCoordinator(runtime: runtime, profiles: [profile])
        let run = Task {
            try await coordinator.run(
                task: AgentTaskRequest(id: "cancel-load", objective: "Do not generate", requiredCapabilities: []),
                steps: [NativeAgentStep(agentId: "reasoner", instructions: "Reason", requiredCapabilities: ["reasoning"])]
            )
        }

        await engine.waitForLoadStart()
        await coordinator.cancelCurrentTask()
        await engine.completeLoad(modelId: "slow-model")

        do {
            _ = try await run.value
            XCTFail("cancellation during model load must stop before generation")
        } catch is CancellationError {
        } catch {
            XCTFail("unexpected error: \\(error)")
        }

        let snapshot = await runtime.snapshot()
        let generationCount = await engine.generationCount
        XCTAssertEqual(snapshot.activeLeaseCount, 0)
        XCTAssertEqual(snapshot.activeUseCount, 0)
        XCTAssertEqual(generationCount, 0)
    }

    func testRoutedPlanWithMissingSpecialistFailsBeforeLoadingAnyModel() async throws {
        let engine = RoutingRecordingEngine(responses: [])
        let runtime = try NativeInferenceRuntime(
            engine: engine,
            poolConfiguration: try ModelPoolConfiguration(
                maxResidentMemoryMB: 1_024,
                maxLoadedModels: 1,
                minimumFreeMemoryMB: 0
            ),
            availableMemoryMB: { 2_048 }
        )
        let profiles = [
            NativeAgentModelProfile(
                model: ModelDescriptor(id: "reasoning-model", name: "Reasoning", path: "/models/reasoning.gguf", contextLength: 4_096),
                capabilities: ["reasoning"], estimatedMemoryMB: 512
            )
        ]
        let coordinator = NativeAgentCoordinator(runtime: runtime, profiles: profiles)
        do {
            _ = try await coordinator.run(
                task: AgentTaskRequest(id: "missing-route", objective: "Review safely", requiredCapabilities: []),
                steps: [
                    NativeAgentStep(agentId: "reasoner", instructions: "Reason", requiredCapabilities: ["reasoning"]),
                    NativeAgentStep(agentId: "security-analyst", instructions: "Review", requiredCapabilities: ["security"])
                ]
            )
            XCTFail("missing specialist route must fail closed")
        } catch NativeAgentCoordinatorError.modelRoutingFailed(_) {
        } catch {
            XCTFail("unexpected error: \\(error)")
        }
        let loadedModelIDs = await engine.loadedModelIDs
        let generatedModelIDs = await engine.generatedModelIDs
        XCTAssertTrue(loadedModelIDs.isEmpty)
        XCTAssertTrue(generatedModelIDs.isEmpty)
    }

}

private actor AgentMessageRecorder {
    private(set) var messages: [AgentMessageEnvelope] = []
    func record(_ message: AgentMessageEnvelope) -> Bool {
        messages.append(message)
        return true
    }
}

private actor RecordingInferenceEngine: LlamaEngine {
    private var responses: [String]
    private(set) var recordedPrompts: [String] = []
    private(set) var cancelledRequestIDs: [String] = []

    init(responses: [String]) { self.responses = responses }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        RuntimeSession(id: "session", modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        recordedPrompts.append(request.prompt)
        let response = responses.isEmpty ? "" : responses.removeFirst()
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: response, isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async { cancelledRequestIDs.append(requestId) }
    func cancelAndWait(sessionId: String, requestId: String) async { cancelledRequestIDs.append(requestId) }
    func unload(sessionId: String) async {}
}


private actor RoutingRecordingEngine: LlamaEngine {
    private var responses: [String]
    private(set) var loadedModelIDs: [String] = []
    private(set) var generatedModelIDs: [String] = []
    private(set) var unloadedSessionIDs: [String] = []

    init(responses: [String]) { self.responses = responses }

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        loadedModelIDs.append(model.id)
        return RuntimeSession(id: "session-\(model.id)", modelId: model.id)
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        generatedModelIDs.append(session.modelId)
        let response = responses.isEmpty ? "" : responses.removeFirst()
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: response, isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async { unloadedSessionIDs.append(sessionId) }
}


private actor BlockingLoadInferenceEngine: LlamaEngine {
    private var loadContinuation: CheckedContinuation<RuntimeSession, Error>?
    private var startContinuation: CheckedContinuation<Void, Never>?
    private var loadStarted = false
    private(set) var generationCount = 0

    func load(model: ModelDescriptor) async throws -> RuntimeSession {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<RuntimeSession, Error>) in
            loadContinuation = continuation
            loadStarted = true
            startContinuation?.resume()
            startContinuation = nil
        }
    }

    func waitForLoadStart() async {
        if loadStarted { return }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            startContinuation = continuation
        }
    }

    func completeLoad(modelId: String) {
        loadContinuation?.resume(returning: RuntimeSession(id: "session-\(modelId)", modelId: modelId))
        loadContinuation = nil
    }

    func generate(session: RuntimeSession, request: GenerationRequest) async throws -> AsyncThrowingStream<Token, Error> {
        generationCount += 1
        return AsyncThrowingStream { continuation in
            continuation.yield(Token(text: "unexpected", isComplete: true))
            continuation.finish()
        }
    }

    func cancel(sessionId: String, requestId: String) async {}
    func cancelAndWait(sessionId: String, requestId: String) async {}
    func unload(sessionId: String) async {}
}

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InMemoryTaskLifecycleStore, TaskLifecycleCoordinator, TaskLifecycleError,
  type TaskLifecycleStore, type TaskRecord
} from "../../autonomy/TaskLifecycleCoordinator";
import {
  GoogleCloudAnalysisWorker, googleCloudLifecycleTaskID, type GoogleCloudAnalysisWorkerOptions
} from "./GoogleCloudAnalysisWorker";
import { prepareGoogleCloudAnalysis, type GoogleCloudPreview } from "./contracts";
import { GOOGLE_CLOUD_AGENT_ID, GOOGLE_CLOUD_COMPONENT_ID } from "./profile";
import { VertexAnalysisProvider, type VertexAnalysisResult } from "./VertexAnalysisProvider";

const destination = { projectID: "pocket-test-project", location: "us-central1", modelID: "gemini-test-model" };
const release = { releaseID: "reviewed-fixture-release", commitSHA: "a".repeat(40), artifactSHA256: "b".repeat(64) };
const attemptID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const selectedText = "Fixture report: three tests passed and one test failed.";
const receipt = Object.freeze({ fixtureOnly: true, approvalID: "approval-1" });

function vertexResponse(text = "Three checks passed; the failed check needs inspection."): Response {
  return new Response(JSON.stringify({
    modelVersion: "gemini-test-model-001", responseId: "-opaque/response:1",
    candidates: [{ index: 0, finishReason: "STOP", content: { role: "model", parts: [{ text }] } }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10, totalTokenCount: 32, thoughtsTokenCount: 2, cachedContentTokenCount: 3 }
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}

async function harness(options: {
  store?: TaskLifecycleStore;
  fetchImpl?: typeof fetch;
  getAccessToken?: (signal: AbortSignal) => Promise<string>;
  createOriginal?: boolean;
} = {}) {
  let milliseconds = Date.parse("2026-11-20T22:00:00.000Z");
  let leaseCounter = 0;
  const store = options.store ?? new InMemoryTaskLifecycleStore();
  const coordinator = new TaskLifecycleCoordinator({
    store, now: () => new Date(milliseconds), workerId: "fixture-worker-1", createId: () => "lease-" + (++leaseCounter)
  });
  await coordinator.init();
  if (options.createOriginal !== false) {
    await coordinator.createTask({ id: "original-task", objective: "Keep the local team result", steps: [{ id: "local", description: "Local work" }] });
    const claim = (await coordinator.claimNextStep("original-task"))!;
    await coordinator.completeStep({ taskId: claim.taskId, stepId: claim.stepId, attemptId: claim.attemptId, result: "Original local result", evidenceRefs: ["local-evidence-1"] });
  }
  const fetchCalls: Array<{ endpoint: string; init: RequestInit; records: TaskRecord[] }> = [];
  let credentialCalls = 0;
  const provider = new VertexAnalysisProvider({
    enabled: true, destination,
    getAccessToken: async signal => { credentialCalls += 1; return options.getAccessToken ? options.getAccessToken(signal) : "fixture-token"; },
    fetchImpl: (async (endpoint, init) => {
      fetchCalls.push({ endpoint: String(endpoint), init: init!, records: store.load() as TaskRecord[] });
      return options.fetchImpl ? options.fetchImpl(endpoint, init) : vertexResponse();
    }) as typeof fetch
  });
  const taskExists = vi.fn((id: string) => coordinator.listTasks().some(task => task.id === id));
  const verifyApproval = vi.fn((_preview: GoogleCloudPreview, value: unknown) => value === receipt);
  const verifyRelease = vi.fn(() => true);
  const workerOptions: GoogleCloudAnalysisWorkerOptions = {
    enabled: true, coordinator, provider, verifyApproval, verifyRelease, taskExists, now: () => milliseconds
  };
  const createPreview = (changes: Partial<Parameters<typeof prepareGoogleCloudAnalysis>[1]> = {}) => prepareGoogleCloudAnalysis({
    task_id: "original-task", purpose: "test-summary", selected_text: selectedText
  }, { attemptID, destination, release, consentExpiresAt: milliseconds + 60_000, now: milliseconds, ...changes });
  const run = (worker = new GoogleCloudAnalysisWorker(workerOptions), preview = createPreview(), signal?: AbortSignal) =>
    worker.run({ preview, approvedDigest: preview.digest, receipt, signal });
  return {
    store, coordinator, provider, workerOptions, fetchCalls, taskExists, verifyApproval, verifyRelease,
    createPreview, run, now: () => milliseconds, advance: (ms: number) => { milliseconds += ms; },
    credentialCalls: () => credentialCalls
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("GoogleCloudAnalysisWorker", () => {
  it("persists and claims a supplementary task before sending only the exact preview body", async () => {
    const h = await harness();
    const original = h.coordinator.getTask("original-task");
    const preview = h.createPreview();
    const evidence = await h.run(undefined, preview);
    expect(h.fetchCalls).toHaveLength(1);
    const sent = h.fetchCalls[0];
    expect(sent.endpoint).toBe(preview.endpoint);
    expect(JSON.parse(sent.init.body as string)).toEqual(preview.requestBody);
    expect(sent.init.redirect).toBe("error");
    const atDispatch = sent.records.find(task => task.id === evidence.lifecycleTaskID)!;
    expect(atDispatch.events.map(event => event.type)).toEqual(["task.created", "step.claimed"]);
    expect(atDispatch.steps[0]).toMatchObject({ status: "running", attempts: 1, maxAttempts: 1, uncertainOnExpiredLease: true });
    expect(atDispatch.metadata).toMatchObject({
      originalTaskID: "original-task", previewDigest: preview.digest, inputSHA256: preview.inputSHA256,
      agentID: GOOGLE_CLOUD_AGENT_ID, componentID: GOOGLE_CLOUD_COMPONENT_ID,
      releaseID: release.releaseID, commitSHA: release.commitSHA, artifactSHA256: release.artifactSHA256
    });
    expect(JSON.stringify(atDispatch)).not.toContain(selectedText);
    expect(JSON.stringify(atDispatch)).not.toContain("fixture-token");
    expect(JSON.stringify(atDispatch)).not.toContain("approval-1");
    expect(evidence).toMatchObject({
      taskID: "original-task", attemptID, previewDigest: preview.digest,
      agentID: GOOGLE_CLOUD_AGENT_ID, componentID: GOOGLE_CLOUD_COMPONENT_ID,
      release, destination, execution: "cloud", providerID: "google-vertex",
      requestedModel: destination.modelID, actualModel: "gemini-test-model-001", providerResponseID: "-opaque/response:1",
      authorized: false, verified: false, finishReason: "STOP"
    });
    const finished = h.coordinator.getTask(evidence.lifecycleTaskID);
    expect(finished.status).toBe("completed");
    expect(JSON.parse(finished.steps[0].result!)).toEqual(evidence);
    expect(h.coordinator.getTask("original-task")).toEqual(original);
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.release)).toBe(true);
    expect(h.verifyApproval).toHaveBeenCalledTimes(3);
    expect(h.verifyRelease).toHaveBeenCalledTimes(3);
    expect(h.taskExists).toHaveBeenCalledTimes(3);
  });

  it.each(["verifyApproval", "verifyRelease", "taskExists"] as const)("fails closed when %s does not return literal true", async key => {
    const h = await harness();
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, [key]: () => "true" } as unknown as GoogleCloudAnalysisWorkerOptions);
    await expect(h.run(worker)).rejects.toMatchObject({
      code: { verifyApproval: "approval_denied", verifyRelease: "release_unapproved", taskExists: "task_unavailable" }[key],
      remoteOutcome: "not_started"
    });
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.credentialCalls()).toBe(0);
    expect(h.coordinator.listTasks()).toHaveLength(1);
  });

  it.each(["verifyApproval", "verifyRelease", "taskExists"] as const)("sanitizes thrown %s failures before dispatch", async key => {
    const h = await harness();
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, [key]: () => { throw new Error("private credential detail"); } });
    const failure = await h.run(worker).catch(error => error);
    expect(failure.remoteOutcome).toBe("not_started");
    expect(failure.message).not.toContain("private");
    expect(h.credentialCalls()).toBe(0);
    expect(h.coordinator.listTasks()).toHaveLength(1);
  });

  it("requires explicit enablement, all host callbacks and a bounded timeout", async () => {
    const h = await harness();
    for (const changes of [{ enabled: false }, { verifyApproval: undefined }, { verifyRelease: undefined }, { taskExists: undefined }, { timeoutMs: 0 }, { timeoutMs: 45_001 }]) {
      expect(() => new GoogleCloudAnalysisWorker({ ...h.workerOptions, ...changes } as GoogleCloudAnalysisWorkerOptions)).toThrow();
    }
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("rejects a mismatched approved digest and changed preview without touching storage", async () => {
    const h = await harness();
    const preview = h.createPreview();
    const worker = new GoogleCloudAnalysisWorker(h.workerOptions);
    await expect(worker.run({ preview, approvedDigest: "c".repeat(64), receipt })).rejects.toMatchObject({ code: "preview_mismatch" });
    const changed = JSON.parse(JSON.stringify(preview));
    changed.requestBody.contents[0].parts[0].text = "A different report";
    await expect(worker.run({ preview: changed, approvedDigest: preview.digest, receipt })).rejects.toMatchObject({ code: "preview_mismatch" });
    expect(h.coordinator.listTasks()).toHaveLength(1);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("rejects a different provider destination even with a valid preview", async () => {
    const h = await harness();
    const preview = h.createPreview({ destination: { ...destination, projectID: "different-project" } });
    await expect(h.run(undefined, preview)).rejects.toMatchObject({ code: "provider_mismatch", remoteOutcome: "not_started" });
    expect(h.credentialCalls()).toBe(0);
  });

  it("never initializes an unprepared lifecycle store implicitly", async () => {
    const h = await harness();
    const coordinator = new TaskLifecycleCoordinator({ store: new InMemoryTaskLifecycleStore() });
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, coordinator });
    await expect(h.run(worker)).rejects.toMatchObject({ code: "persistence_failed", remoteOutcome: "not_started" });
    expect(h.credentialCalls()).toBe(0);
  });

  it("rechecks approval after durable reservation and refuses a withdrawal", async () => {
    const h = await harness();
    let checks = 0;
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, verifyApproval: () => ++checks === 1 });
    await expect(h.run(worker)).rejects.toMatchObject({ code: "approval_denied", remoteOutcome: "not_started" });
    expect(h.coordinator.getTask(googleCloudLifecycleTaskID(h.createPreview())).steps[0]).toMatchObject({ status: "failed", uncertain: false, attempts: 1 });
    expect(h.credentialCalls()).toBe(0);
  });

  it.each(["verifyRelease", "taskExists"] as const)("rechecks %s after storage", async key => {
    const h = await harness();
    let checks = 0;
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, [key]: () => ++checks === 1 });
    await expect(h.run(worker)).rejects.toMatchObject({ code: key === "verifyRelease" ? "release_unapproved" : "task_unavailable", remoteOutcome: "not_started" });
    expect(h.credentialCalls()).toBe(0);
  });

  it.each(["ready", "running"])("does not dispatch when persistence of %s fails", async status => {
    const backing = new InMemoryTaskLifecycleStore();
    const store: TaskLifecycleStore = {
      load: () => backing.load(),
      save: records => {
        if (records.some(task => task.metadata.kind === "google-cloud-analysis" && task.status === status)) throw new Error("private DB detail");
        backing.save(records);
      }
    };
    const h = await harness({ store });
    await expect(h.run()).rejects.toMatchObject({ code: "persistence_failed", remoteOutcome: "not_started" });
    expect(h.credentialCalls()).toBe(0);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("rejects simultaneous attempts with the same durable identity", async () => {
    const h = await harness();
    const results = await Promise.allSettled([h.run(), h.run()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejection.reason).toMatchObject({ code: "duplicate_attempt", remoteOutcome: "unknown" });
    expect(h.fetchCalls).toHaveLength(1);
  });

  it("blocks replay after coordinator restart using the supplied store", async () => {
    const h = await harness();
    const evidence = await h.run();
    const restarted = new TaskLifecycleCoordinator({ store: h.store, workerId: "fixture-worker-2", now: () => new Date(h.now()) });
    await restarted.init();
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, coordinator: restarted });
    await expect(h.run(worker)).rejects.toMatchObject({ code: "duplicate_attempt", remoteOutcome: "unknown" });
    expect(restarted.getTask(evidence.lifecycleTaskID).status).toBe("completed");
    expect(h.fetchCalls).toHaveLength(1);
  });

  it("blocks reuse of the same attempt for a new valid digest", async () => {
    const h = await harness();
    const first = await h.run();
    const changed = prepareGoogleCloudAnalysis({ task_id: "original-task", purpose: "test-summary", selected_text: "Different approved report" }, {
      attemptID, destination, release, consentExpiresAt: h.now() + 60_000, now: h.now()
    });
    await expect(h.run(undefined, changed)).rejects.toMatchObject({ code: "duplicate_attempt" });
    expect(JSON.parse(h.coordinator.getTask(first.lifecycleTaskID).steps[0].result!)).toEqual(first);
    expect(h.fetchCalls).toHaveLength(1);
  });

  it("requires a conflict-safe host store and does not retry a CAS conflict", async () => {
    const backing = new InMemoryTaskLifecycleStore();
    const store: TaskLifecycleStore = {
      load: () => backing.load(),
      save: records => {
        if (records.some(task => task.metadata.kind === "google-cloud-analysis")) throw new TaskLifecycleError("store_conflict", "fixture CAS conflict");
        backing.save(records);
      }
    };
    const h = await harness({ store });
    await expect(h.run()).rejects.toMatchObject({ code: "persistence_failed", remoteOutcome: "not_started" });
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.coordinator.listTasks()).toHaveLength(1);
  });

  it("records a provider failure as uncertain and never requeues it", async () => {
    const h = await harness({ fetchImpl: (async () => new Response("secret failure body", { status: 503 })) as typeof fetch });
    await expect(h.run()).rejects.toMatchObject({ code: "upstream_failed", remoteOutcome: "unknown" });
    const taskID = googleCloudLifecycleTaskID(h.createPreview());
    expect(h.coordinator.getTask(taskID).steps[0]).toMatchObject({ status: "failed", uncertain: true, attempts: 1, maxAttempts: 1 });
    expect(await h.coordinator.claimNextStep(taskID)).toBeNull();
    await expect(h.run()).rejects.toMatchObject({ code: "duplicate_attempt" });
    expect(h.fetchCalls).toHaveLength(1);
  });

  it("returns an unknown outcome when successful provider output cannot be committed", async () => {
    const backing = new InMemoryTaskLifecycleStore();
    const store: TaskLifecycleStore = {
      load: () => backing.load(),
      save: records => {
        if (records.some(task => task.metadata.kind === "google-cloud-analysis" && task.status === "completed")) throw new Error("private store detail");
        backing.save(records);
      }
    };
    const h = await harness({ store });
    await expect(h.run()).rejects.toMatchObject({ code: "persistence_failed", remoteOutcome: "unknown" });
    expect(h.coordinator.getTask(googleCloudLifecycleTaskID(h.createPreview())).steps[0]).toMatchObject({ status: "failed", uncertain: true, result: null });
    expect(h.fetchCalls).toHaveLength(1);
  });

  it("leaves a recoverable uncertain lease if all storage fails after dispatch", async () => {
    const backing = new InMemoryTaskLifecycleStore();
    let storageUnavailable = false;
    const store: TaskLifecycleStore = {
      load: () => backing.load(), save: records => {
        if (storageUnavailable) throw new Error("unavailable");
        backing.save(records);
      }
    };
    const h = await harness({ store, fetchImpl: (async () => { storageUnavailable = true; return vertexResponse(); }) as typeof fetch });
    await expect(h.run()).rejects.toMatchObject({ code: "persistence_failed", remoteOutcome: "unknown" });
    const taskID = googleCloudLifecycleTaskID(h.createPreview());
    expect(h.coordinator.getTask(taskID).steps[0].status).toBe("running");
    storageUnavailable = false;
    h.advance(50_001);
    expect(await h.coordinator.recoverExpiredLeases(taskID)).toBe(1);
    expect(h.coordinator.getTask(taskID).steps[0]).toMatchObject({ status: "failed", uncertain: true });
    expect(await h.coordinator.claimNextStep(taskID)).toBeNull();
    expect(h.fetchCalls).toHaveLength(1);
  });

  it("honors cancellation before any callback or storage access", async () => {
    const h = await harness();
    const signal = new AbortController();
    signal.abort();
    await expect(h.run(undefined, h.createPreview(), signal.signal)).rejects.toMatchObject({ code: "cancelled", remoteOutcome: "not_started" });
    expect(h.verifyApproval).not.toHaveBeenCalled();
    expect(h.credentialCalls()).toBe(0);
  });

  it("bounds a stalled approval callback and never dispatches after it resolves late", async () => {
    vi.useFakeTimers();
    const h = await harness();
    const approval = deferred<boolean>();
    const entered = deferred<void>();
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, timeoutMs: 100, verifyApproval: () => { entered.resolve(); return approval.promise; } });
    const result = expect(h.run(worker)).rejects.toMatchObject({ code: "deadline_exceeded", remoteOutcome: "not_started" });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(100);
    await result;
    approval.resolve(true);
    await vi.runAllTimersAsync();
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.coordinator.listTasks()).toHaveLength(1);
  });

  it("does not resume dispatch after a timed-out persistence write finishes late", async () => {
    vi.useFakeTimers();
    const backing = new InMemoryTaskLifecycleStore();
    const entered = deferred<void>();
    const releaseSave = deferred<void>();
    const store: TaskLifecycleStore = {
      load: () => backing.load(),
      save: async records => {
        if (records.some(task => task.metadata.kind === "google-cloud-analysis")) {
          entered.resolve();
          await releaseSave.promise;
        }
        backing.save(records);
      }
    };
    const h = await harness({ store });
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, timeoutMs: 100 });
    const result = expect(h.run(worker)).rejects.toMatchObject({ code: "deadline_exceeded", remoteOutcome: "not_started" });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(100);
    await result;
    releaseSave.resolve();
    await vi.runAllTimersAsync();
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.credentialCalls()).toBe(0);
    const taskID = googleCloudLifecycleTaskID(h.createPreview());
    expect(h.coordinator.getTask(taskID).steps[0]).toMatchObject({ status: "pending", attempts: 0 });
    await expect(h.run(worker)).rejects.toMatchObject({ code: "duplicate_attempt", remoteOutcome: "unknown" });
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("rejects consent expiry after asynchronous approval", async () => {
    const h = await harness();
    const preview = h.createPreview({ consentExpiresAt: h.now() + 1_000 });
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, verifyApproval: async () => { h.advance(1_001); return true; } });
    await expect(h.run(worker, preview)).rejects.toMatchObject({ code: "consent_expired", remoteOutcome: "not_started" });
    expect(h.credentialCalls()).toBe(0);
  });

  it("rechecks expiry after claiming persistence before provider invocation", async () => {
    const backing = new InMemoryTaskLifecycleStore();
    let onClaim = () => {};
    const store: TaskLifecycleStore = {
      load: () => backing.load(), save: records => {
        backing.save(records);
        if (records.some(task => task.metadata.kind === "google-cloud-analysis" && task.status === "running")) onClaim();
      }
    };
    const h = await harness({ store });
    onClaim = () => h.advance(1_001);
    const preview = h.createPreview({ consentExpiresAt: h.now() + 1_000 });
    await expect(h.run(undefined, preview)).rejects.toMatchObject({ code: "consent_expired", remoteOutcome: "not_started" });
    expect(h.credentialCalls()).toBe(0);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("aborts a stalled credential lookup at consent expiry without sending HTTP", async () => {
    vi.useFakeTimers();
    const token = deferred<string>();
    const entered = deferred<void>();
    const h = await harness({ getAccessToken: async () => { entered.resolve(); return token.promise; } });
    const preview = h.createPreview({ consentExpiresAt: h.now() + 100 });
    const result = expect(h.run(undefined, preview)).rejects.toMatchObject({ code: "consent_expired", remoteOutcome: "unknown" });
    await entered.promise;
    await vi.advanceTimersByTimeAsync(100);
    await result;
    token.resolve("late-fixture-token");
    await vi.runAllTimersAsync();
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.coordinator.getTask(googleCloudLifecycleTaskID(preview)).steps[0].uncertain).toBe(true);
  });

  it("rechecks wall-clock consent immediately before HTTP after credentials resolve", async () => {
    let advance = (_ms: number) => {};
    const h = await harness({ getAccessToken: async () => { advance(1_001); return "fixture-token"; } });
    advance = h.advance;
    const preview = h.createPreview({ consentExpiresAt: h.now() + 1_000 });
    await expect(h.run(undefined, preview)).rejects.toMatchObject({ code: "consent_expired", remoteOutcome: "unknown" });
    expect(h.credentialCalls()).toBe(1);
    expect(h.fetchCalls).toHaveLength(0);
  });

  it.each(["verifyApproval", "verifyRelease", "taskExists"] as const)("rechecks %s withdrawal during credential acquisition before HTTP", async key => {
    let allowed = true;
    const h = await harness({ getAccessToken: async () => { allowed = false; return "fixture-token"; } });
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, [key]: () => allowed });
    await expect(h.run(worker)).rejects.toMatchObject({
      code: { verifyApproval: "approval_denied", verifyRelease: "release_unapproved", taskExists: "task_unavailable" }[key],
      remoteOutcome: "unknown"
    });
    expect(h.credentialCalls()).toBe(1);
    expect(h.fetchCalls).toHaveLength(0);
    expect(h.coordinator.getTask(googleCloudLifecycleTaskID(h.createPreview())).steps[0]).toMatchObject({ status: "failed", uncertain: true });
  });

  it("treats cancellation after HTTP dispatch as uncertain even when fetch ignores abort", async () => {
    const upstream = deferred<Response>();
    const entered = deferred<void>();
    const h = await harness({ fetchImpl: (async () => { entered.resolve(); return upstream.promise; }) as typeof fetch });
    const abort = new AbortController();
    const result = expect(h.run(undefined, h.createPreview(), abort.signal)).rejects.toMatchObject({ code: "cancelled", remoteOutcome: "unknown" });
    await entered.promise;
    abort.abort();
    await result;
    upstream.resolve(vertexResponse());
    expect(h.coordinator.getTask(googleCloudLifecycleTaskID(h.createPreview())).steps[0]).toMatchObject({ status: "failed", uncertain: true, result: null });
    expect(h.fetchCalls).toHaveLength(1);
  });

  it("honors lifecycle cancellation requested before dispatch without claiming remote drain", async () => {
    const h = await harness();
    const preview = h.createPreview();
    let checks = 0;
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, verifyApproval: async () => {
      if (++checks === 2) await h.coordinator.cancelTask(googleCloudLifecycleTaskID(preview));
      return true;
    } });
    await expect(h.run(worker, preview)).rejects.toMatchObject({ code: "cancelled", remoteOutcome: "not_started" });
    const task = h.coordinator.getTask(googleCloudLifecycleTaskID(preview));
    expect(task.events.map(event => event.type)).toContain("task.cancel_requested");
    expect(task.events.map(event => event.type)).not.toContain("step.cancelled");
    expect(h.fetchCalls).toHaveLength(0);
  });

  it("rejects an evidence envelope too large for the existing lifecycle result bound", async () => {
    const h = await harness({ fetchImpl: (async () => vertexResponse("A" + "\u0001".repeat(3_000))) as typeof fetch });
    await expect(h.run()).rejects.toMatchObject({ code: "invalid_response", remoteOutcome: "unknown" });
    expect(h.coordinator.getTask(googleCloudLifecycleTaskID(h.createPreview())).steps[0].result).toBeNull();
  });

  it.each(["sum", "cached", "tools", "model", "authority"])("revalidates injected result %s fields before durable completion", async mutation => {
    const h = await harness();
    const provider = {
      providerID: h.provider.providerID, destination: h.provider.destination,
      endpoint: h.provider.endpoint, requestedModel: h.provider.requestedModel,
      generate: async (...args: Parameters<VertexAnalysisProvider["generate"]>): Promise<VertexAnalysisResult> => {
        const result = await h.provider.generate(...args);
        if (mutation === "sum") result.usage.totalTokens += 1;
        if (mutation === "cached") result.usage.cachedContentTokens = result.usage.promptTokens + 1;
        if (mutation === "tools") (result.usage as { toolUsePromptTokens: number }).toolUsePromptTokens = 1;
        if (mutation === "model") result.requestedModel = "other-model";
        if (mutation === "authority") Object.assign(result, { authorized: true, verified: true });
        return result;
      }
    };
    const worker = new GoogleCloudAnalysisWorker({ ...h.workerOptions, provider });
    if (mutation === "authority") {
      expect(await h.run(worker)).toMatchObject({ authorized: false, verified: false });
    } else {
      await expect(h.run(worker)).rejects.toMatchObject({ code: "invalid_response", remoteOutcome: "unknown" });
      expect(h.coordinator.getTask(googleCloudLifecycleTaskID(h.createPreview())).steps[0].result).toBeNull();
    }
  });
});

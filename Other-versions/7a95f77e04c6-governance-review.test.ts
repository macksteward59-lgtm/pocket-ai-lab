import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TeamExpansionDenied, TeamExpansionPlanner } from "../agents/TeamExpansionPlanner";
import { DelegationGate } from "../security/delegation";
import { SecurityDivision } from "../security/SecurityDivision";
import { GOVERNANCE_ADVISORY_INVARIANT, specialistPrompt } from "../agents/specialists/dynamicCatalog";
import { classifyExport, watchOnce } from "../governance/watchInbox";
import { FileMemoryStore } from "../memory/FileMemoryStore";
import { ContextIngester } from "../memory/ContextIngester";
import { MemoryManager } from "../memory/MemoryManager";
import { MessageBus } from "../message-bus/MessageBus";
import { ModelRouterResiliency } from "../model-router/ModelRouterResiliency";
import { Orchestrator } from "../orchestrator/Orchestrator";
import { StaticAnalysisOrchestratorBridge } from "../orchestrator/StaticAnalysisOrchestratorBridge";
import { AuditLedger } from "../security/AuditLedger";
import { EVIDENCE_MARKDOWN_HEADERS, synthesizeEvidence } from "../security/EvidenceSynthesizer";
import { PolicyChecker } from "../security/PolicyChecker";
import { AgentManager } from "../agents/AgentManager";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

function orchestrator(): Orchestrator {
  return new Orchestrator({
    inference: { async generate() { return { payload: { analysis: "unused" } }; } },
    getResources: () => ({ availableMemoryMB: 4096, loadedModels: [] })
  });
}

function finding(id: string, inScope: boolean, severity = "High") {
  return {
    finding_id: id,
    title: "TLS certificate missing on the login host",
    vulnerability_type: "tls",
    severity,
    confidence_level: "Certain",
    affected_parameters: [],
    reproduction_checklists: ["Apply the header outside this pipeline."],
    asset: {
      target_uri: "https://app.example.com/login",
      base_domain: "app.example.com",
      is_in_scope: inScope
    },
    authorized: false as const
  };
}

function envelope(state: "REVIEW_READY" | "REJECTED", findings: ReturnType<typeof finding>[], violations: unknown[] = []) {
  return {
    authorized: false,
    boundary_violations: violations,
    review_package: {
      package_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source_format: "burp",
      state,
      authorized: false,
      requires_human_approval: true,
      audit_trail_logs: [state],
      findings
    }
  };
}

describe("governance review intake", () => {
  it("spawns advisory specialists for an allowlisted finding and keeps authorized false", async () => {
    const host = orchestrator();
    const ledgerDir = await mkdtemp(path.join(tmpdir(), "governance-ledger-"));
    dirs.push(ledgerDir);
    const created: string[] = [];
    const original = host.agents.createSpecialist.bind(host.agents);
    host.agents.createSpecialist = profile => {
      const id = original(profile);
      created.push(id);
      return id;
    };
    const id = crypto.randomUUID();
    const calls: string[] = [];
    const result = await host.handleScanTelemetryUpload({
      taskId: "gate-review",
      sourceFormat: "burp",
      content: "<issues/>",
      sidecarUrl: "http://127.0.0.1:8765",
      ledger: new AuditLedger(path.join(ledgerDir, "audit.jsonl")),
      fetchImpl: async request => {
        calls.push(String(request));
        return new Response(JSON.stringify(envelope("REVIEW_READY", [finding(id, true)])), { status: 200 });
      }
    });
    expect(calls).toEqual(["http://127.0.0.1:8765/api/v1/governance/review"]);
    expect(result.authorized).toBe(false);
    expect(result.reviewPackage.state).toBe("REVIEW_READY");
    expect(result.specialistIds.length).toBeGreaterThan(0);
    expect(created).toEqual(result.specialistIds);
    for (const specialistId of created) {
      const profile = host.agents.getAgent(specialistId);
      expect(profile?.permanent).toBe(false);
      expect(profile?.permissions).toEqual(["lab"]);
    }
    expect(host.bus.getThread("gate-review").some(message =>
      message.messageType === "analysis" &&
      typeof (message.payload as { analysis?: string }).analysis === "string" &&
      (message.payload as { analysis: string }).analysis.includes(GOVERNANCE_ADVISORY_INVARIANT)
    )).toBe(true);
    expect(result.evidence.authorized).toBe(false);
    expect(result.evidence.requiresHumanApproval).toBe(true);
    expect(result.evidence.markdown.startsWith(EVIDENCE_MARKDOWN_HEADERS.title)).toBe(true);
    expect(result.evidence.markdown).toContain(EVIDENCE_MARKDOWN_HEADERS.authorization);
    expect(result.evidence.markdown).toContain("authorized: false");
    expect(result.evidence.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result).includes('"authorized":true')).toBe(false);
    expect(result.compliance.criticalWarnings.length).toBeGreaterThan(0);
    const thread = host.bus.getThread("gate-review");
    expect(thread.some(message => message.recipientAgentId === "security" && message.messageType === "analysis")).toBe(true);
    expect(thread.some(message => message.recipientAgentId === "archivist" && message.messageType === "analysis")).toBe(true);
    expect(host.memory.list().every(entry => entry.provenance.verified === false)).toBe(true);
    const ledger = new AuditLedger(path.join(ledgerDir, "audit.jsonl"));
    expect(await ledger.verify()).toBe(true);
    const records = await ledger.read();
    expect(records[1].prevHash).toBe(records[0].hash);
  });

  it("drops an out-of-scope finding and publishes SecurityBoundaryViolation", async () => {
    const host = orchestrator();
    const ledgerDir = await mkdtemp(path.join(tmpdir(), "governance-ledger-"));
    dirs.push(ledgerDir);
    let spawned = 0;
    const original = host.agents.createSpecialist.bind(host.agents);
    host.agents.createSpecialist = profile => {
      spawned += 1;
      return original(profile);
    };
    const id = crypto.randomUUID();
    const violation = {
      event: "SecurityBoundaryViolation",
      event_id: crypto.randomUUID(),
      reason: "Target is outside the operator allowlist",
      finding_id: id,
      asset: {
        target_uri: "https://other.example/login",
        base_domain: "other.example",
        is_in_scope: false
      },
      authorized: false
    };
    const result = await host.handleScanTelemetryUpload({
      taskId: "gate-drop",
      sourceFormat: "nessus",
      content: "not,a,report",
      sidecarUrl: "http://localhost:8765",
      ledger: new AuditLedger(path.join(ledgerDir, "audit.jsonl")),
      fetchImpl: async () => new Response(JSON.stringify(envelope("REJECTED", [], [violation])), { status: 200 })
    });
    expect(result.reviewPackage.state).toBe("REJECTED");
    expect(result.reviewPackage.findings).toEqual([]);
    expect(result.specialistIds).toEqual([]);
    expect(spawned).toBe(0);
    expect(result.authorized).toBe(false);
    const thread = host.bus.getThread("gate-drop");
    expect(thread).toHaveLength(1);
    expect(thread[0].messageType).toBe("security_boundary_violation");
    expect(thread[0].payload).toMatchObject({ event: "SecurityBoundaryViolation" });
  });

  it("refuses a non-loopback sidecar and a response that sets authorized true", async () => {
    const bus = new MessageBus();
    let called = 0;
    const hostile = new PolicyChecker({
      baseUrl: "https://example.com",
      bus,
      taskId: "t",
      fetchImpl: async () => {
        called += 1;
        return new Response("{}", { status: 200 });
      }
    });
    await expect(hostile.submitTelemetryForReview({ sourceFormat: "burp", content: "x" })).rejects.toThrow(/loopback/);
    expect(called).toBe(0);
    const granted = new PolicyChecker({
      baseUrl: "http://127.0.0.1:9",
      bus,
      taskId: "t",
      fetchImpl: async () => new Response(JSON.stringify({ authorized: true }), { status: 200 })
    });
    await expect(granted.submitTelemetryForReview({ sourceFormat: "zap", content: "x" })).rejects.toThrow(/authorized/);
  });
});

describe("governance evidence and catalog", () => {
  it("fingerprints evidence and prepends the advisory invariant", () => {
    const id = crypto.randomUUID();
    const document = synthesizeEvidence({
      packageId: id,
      sourceFormat: "burp",
      findings: [finding(crypto.randomUUID(), true, "Low")]
    });
    expect(document.authorized).toBe(false);
    expect(document.requiresHumanApproval).toBe(true);
    expect(document.markdown).toContain(EVIDENCE_MARKDOWN_HEADERS.fingerprint);
    expect(document.markdown).toContain(EVIDENCE_MARKDOWN_HEADERS.remediation);
    expect(document.markdown).toContain(EVIDENCE_MARKDOWN_HEADERS.boundary);
    const prompt = specialistPrompt("azure-tenant-isolation", "Describe the missing header.");
    expect(prompt.startsWith(GOVERNANCE_ADVISORY_INVARIANT)).toBe(true);
    expect(prompt).toContain("forbidden from drafting working exploit tools");
  });

  it("does not spawn a review team when the finding is out of scope", async () => {
    const agents = new AgentManager();
    const planner = new TeamExpansionPlanner({
      division: new SecurityDivision({ agents, gate: new DelegationGate() })
    });
    await expect(planner.expandForInScopeReview({
      taskId: "task",
      inScope: false,
      title: "TLS certificate missing"
    })).rejects.toThrow(TeamExpansionDenied);
    expect(agents.getAgent("security")).toBeUndefined();
  });

  it("stores unverified context through FileMemoryStore", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "governance-memory-"));
    dirs.push(dir);
    const store = await FileMemoryStore.open(dir);
    const memory = new MemoryManager(store);
    await memory.init();
    const ingester = new ContextIngester(memory);
    await ingester.ingest({
      taskId: "mem-task",
      title: "Missing security header",
      summary: "Apply the header outside this pipeline.",
      sourceRef: "finding-1"
    });
    const reloaded = new MemoryManager(await FileMemoryStore.open(dir));
    await reloaded.init();
    const stored = reloaded.list();
    expect(stored).toHaveLength(1);
    expect(stored[0].provenance.verified).toBe(false);
    expect(new ContextIngester(reloaded).related("security header").length).toBe(1);
  });

  it("retries routing without inventing a model", async () => {
    let calls = 0;
    const router = {
      async route() {
        calls += 1;
        if (calls === 1) throw new Error("temporary");
        return {
          id: "local",
          name: "Local",
          path: "llama-server",
          contextLength: 1024,
          capabilities: ["reason"],
          memoryEstimateMB: 128
        };
      }
    };
    const selected = await new ModelRouterResiliency(router).routeWithRetry("reasoner", undefined, []);
    expect(selected.id).toBe("local");
    expect(calls).toBe(2);
    await expect(new ModelRouterResiliency({
      async route() { throw new Error("still down"); }
    }, 2).routeWithRetry("reasoner", undefined, [])).rejects.toThrow(/still down/);
  });
});

describe("static bridge and inbox watcher", () => {
  it("rejects an analysis report that claims execution", async () => {
    const bridge = new StaticAnalysisOrchestratorBridge({
      baseUrl: "http://127.0.0.1:8765",
      fetchImpl: async () => new Response(JSON.stringify({ authorized: false, executes: true, filename: "a.py", observations: [], context: {} }), { status: 200 })
    });
    await expect(bridge.analyzeSource({ filename: "a.py", source: "print(1)" })).rejects.toThrow(/non-executing/);
  });

  it("posts only the sidecar URL for a local export", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "governance-inbox-"));
    dirs.push(dir);
    const inbox = path.join(dir, "inbox");
    const outbox = path.join(dir, "outbox");
    await mkdir(inbox, { recursive: true });
    await writeFile(path.join(inbox, "sample.burp.xml"), "<issues/>");
    const urls: string[] = [];
    const result = await watchOnce({
      inbox,
      outbox,
      sidecarUrl: "http://127.0.0.1:8765",
      fetchImpl: async request => {
        urls.push(String(request));
        return new Response(JSON.stringify(envelope("REJECTED", [])), { status: 200 });
      }
    });
    expect(classifyExport("sample.burp.xml")).toBe("burp");
    expect(classifyExport("scan.nessus.csv")).toBe("nessus");
    expect(classifyExport("notes.txt")).toBeNull();
    expect(result.submitted).toEqual(["sample.burp.xml"]);
    expect(urls).toEqual(["http://127.0.0.1:8765/api/v1/governance/review"]);
    expect(await readFile(path.join(outbox, "sample.burp.xml.review.json"), "utf8")).toContain('"authorized": false');
  });
});

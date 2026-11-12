/**
 * Director Tool Workshop.
 *
 * The Director may propose, create, extend, revise, test, and retire tool
 * artifacts. Generated source is always untrusted data: this module never
 * evaluates it, launches a process, installs dependencies, or executes it.
 * A host must inject an isolated sandbox, artifact store, and independent
 * approval verifier before a draft can be tested or activated.
 *
 * Activation registers metadata only. Actual tool execution remains a
 * separate host responsibility and must still pass SecurityDivision,
 * DelegationGate, and any applicable APEX/East authorization.
 */
import type { ToolDescriptor, ToolRegistry } from "../security/tools";
import type { SecuritySpecialistId } from "../agents/AgentManager";

export type ToolChangeKind = "create" | "extend" | "revise";
export type ToolArtifactStatus = "draft" | "testing" | "quarantined" | "ready" | "active" | "retired";

export interface ToolBuildSpec {
  id: string;
  name: string;
  purpose: string;
  specialists: SecuritySpecialistId[];
  change: ToolChangeKind;
  requirements: string[];
}

export interface ToolArtifact {
  toolId: string;
  version: number;
  spec: ToolBuildSpec;
  digest: string;
  files: Record<string, string>;
  createdAt: string;
  status: ToolArtifactStatus;
  testSummary?: ToolTestSummary;
  previousDigest?: string;
}

export interface ToolTestSummary {
  passed: boolean;
  testsRun: number;
  testsPassed: number;
  findings: string[];
  completedAt: string;
}

export interface ToolBuilder {
  /** Generates source files only. The returned source is untrusted. */
  build(input: { spec: ToolBuildSpec; previous?: ToolArtifact }): Promise<{ files: Record<string, string> }>;
}

export interface ToolSandbox {
  /**
   * Must execute candidate code in a disposable, network-denied, resource-
   * limited sandbox with no host secrets or production credentials.
   */
  test(input: { spec: ToolBuildSpec; artifact: ToolArtifact }): Promise<ToolTestSummary>;
}

export interface ToolApprovalRequest {
  taskId: string;
  toolId: string;
  version: number;
  digest: string;
  approvalRef: string;
}

export interface ToolApprovalVerifier {
  /** Must verify an independent human approval bound to this exact digest. */
  verify(input: ToolApprovalRequest): boolean | Promise<boolean>;
}

export interface ToolArtifactStore {
  getLatest(toolId: string): Promise<ToolArtifact | undefined>;
  put(artifact: ToolArtifact): Promise<void>;
  list(): Promise<ToolArtifact[]>;
}

export class InMemoryToolArtifactStore implements ToolArtifactStore {
  private readonly artifacts = new Map<string, ToolArtifact[]>();

  async getLatest(toolId: string): Promise<ToolArtifact | undefined> {
    const items = this.artifacts.get(toolId);
    const item = items?.[items.length - 1];
    return item ? cloneArtifact(item) : undefined;
  }

  async put(artifact: ToolArtifact): Promise<void> {
    const items = this.artifacts.get(artifact.toolId) ?? [];
    if (items.some(item => item.version === artifact.version)) {
      throw new Error("Tool artifact version already exists");
    }
    const existingIndex = items.findIndex(item => item.version === artifact.version);
    if (existingIndex >= 0) items[existingIndex] = cloneArtifact(artifact);
    else items.push(cloneArtifact(artifact));
    this.artifacts.set(artifact.toolId, items);
  }

  async list(): Promise<ToolArtifact[]> {
    return [...this.artifacts.values()].flat().map(cloneArtifact);
  }
}

export interface ToolDirectorOptions {
  registry: ToolRegistry;
  builder?: ToolBuilder;
  sandbox?: ToolSandbox;
  approvalVerifier?: ToolApprovalVerifier;
  store?: ToolArtifactStore;
  now?: () => number;
}

export class ToolDirector {
  private readonly registry: ToolRegistry;
  private readonly builder?: ToolBuilder;
  private readonly sandbox?: ToolSandbox;
  private readonly approvalVerifier?: ToolApprovalVerifier;
  private readonly store: ToolArtifactStore;
  private readonly now: () => number;

  constructor(options: ToolDirectorOptions) {
    this.registry = options.registry;
    this.builder = options.builder;
    this.sandbox = options.sandbox;
    this.approvalVerifier = options.approvalVerifier;
    this.store = options.store ?? new InMemoryToolArtifactStore();
    this.now = options.now ?? (() => Date.now());
  }

  /** Build and test a new tool or a revision of an existing tool. Never activates it. */
  async develop(spec: ToolBuildSpec): Promise<ToolArtifact> {
    this.validateSpec(spec);
    if (!this.builder) throw new Error("Tool builder is not configured");
    if (!this.sandbox) throw new Error("Isolated tool sandbox is not configured");

    const existing = this.registry.has(spec.id);
    const previous = await this.store.getLatest(spec.id);
    if (spec.change === "create" && (existing || previous)) throw new Error("Tool already exists; use extend or revise");
    if (spec.change !== "create" && !previous) {
      throw new Error(existing ? "Built-in tools cannot be revised by the Director workshop" : "Cannot extend or revise an unknown tool");
    }

    const built = await this.builder.build({ spec: cloneSpec(spec), previous });
    const files = validateFiles(built?.files);
    const digest = await digestFiles(files);
    const artifact: ToolArtifact = {
      toolId: spec.id,
      version: (previous?.version ?? 0) + 1,
      spec: cloneSpec(spec),
      digest,
      files,
      createdAt: new Date(this.now()).toISOString(),
      status: "testing",
      previousDigest: previous?.digest
    };

    await this.store.put(artifact);
    let testSummary: ToolTestSummary;
    try {
      testSummary = await this.sandbox.test({ spec: cloneSpec(spec), artifact: cloneArtifact(artifact) });
    } catch (error) {
      const quarantined = { ...artifact, status: "quarantined" as const,
        testSummary: { passed: false, testsRun: 0, testsPassed: 0,
          findings: ["Sandbox failed: " + safeError(error)], completedAt: new Date(this.now()).toISOString() } };
      await this.store.put(quarantined);
      return cloneArtifact(quarantined);
    }

    const result: ToolArtifact = {
      ...artifact,
      status: testSummary.passed && testSummary.testsRun > 0 && testSummary.testsPassed === testSummary.testsRun
        ? "ready" : "quarantined",
      testSummary: cloneTestSummary(testSummary)
    };
    await this.store.put(result);
    return cloneArtifact(result);
  }

  /** Register or update tool metadata only after tests and digest-bound approval. */
  async activate(input: { taskId: string; toolId: string; version: number; approvalRef: string }): Promise<ToolDescriptor> {
    if (!this.approvalVerifier) throw new Error("Independent tool activation approval is not configured");
    if (!input.taskId?.trim() || !input.approvalRef?.trim()) throw new Error("taskId and approvalRef are required");
    const artifacts = await this.store.list();
    const artifact = artifacts.find(item => item.toolId === input.toolId && item.version === input.version);
    if (!artifact) throw new Error("Unknown tool artifact version");
    if (artifact.status !== "ready" || !artifact.testSummary?.passed) {
      throw new Error("Only a fully tested ready artifact can be activated");
    }
    const approved = await this.approvalVerifier.verify({
      taskId: input.taskId, toolId: artifact.toolId, version: artifact.version,
      digest: artifact.digest, approvalRef: input.approvalRef
    });
    if (approved !== true) throw new Error("Tool activation approval was denied");

    const descriptor: ToolDescriptor = {
      id: artifact.toolId,
      name: artifact.spec.name,
      application: artifact.spec.purpose,
      // Generated code is always classified active: it must pass a fresh, per-use human approval.
      mode: "active",
      specialists: [...artifact.spec.specialists]
    };
    if (this.registry.has(descriptor.id)) this.registry.replaceManaged(descriptor);
    else this.registry.registerManaged(descriptor);
    return descriptorCopy(descriptor);
  }

  /** Retiring removes requestable metadata; it does not delete artifact history. */
  async retire(input: { toolId: string; taskId: string; approvalRef: string }): Promise<void> {
    if (!this.approvalVerifier) throw new Error("Independent tool retirement approval is not configured");
    const latest = await this.store.getLatest(input.toolId);
    if (!latest || latest.status === "retired") throw new Error("No active managed tool to retire");
    const approved = await this.approvalVerifier.verify({
      taskId: input.taskId, toolId: latest.toolId, version: latest.version,
      digest: latest.digest, approvalRef: input.approvalRef
    });
    if (approved !== true) throw new Error("Tool retirement approval was denied");
    this.registry.unregisterManaged(input.toolId);
    await this.store.put({ ...latest, version: latest.version + 1, status: "retired",
      createdAt: new Date(this.now()).toISOString(), previousDigest: latest.digest });
  }

  listArtifacts(): Promise<ToolArtifact[]> {
    return this.store.list();
  }

  private validateSpec(spec: ToolBuildSpec): void {
    if (!spec || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.id)) throw new Error("Tool id must be a lowercase kebab-case identifier");
    if (!spec.name?.trim() || !spec.purpose?.trim()) throw new Error("Tool name and purpose are required");
    if (!Array.isArray(spec.specialists) || spec.specialists.length === 0) throw new Error("At least one allowed specialist is required");
    if (!Array.isArray(spec.requirements) || spec.requirements.length === 0 || spec.requirements.some(value => !value.trim())) {
      throw new Error("At least one concrete tool requirement is required");
    }
  }

}

function validateFiles(input: Record<string, string> | undefined): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Builder must return a file map");
  const entries = Object.entries(input);
  if (entries.length === 0 || entries.length > 40) throw new Error("Tool bundle must contain 1–40 files");
  const output: Record<string, string> = {};
  for (const [path, content] of entries) {
    if (!path || path.startsWith("/") || path.includes("\\") ||
        path.split("/").some(part => !part || part === "." || part === "..")) {
      throw new Error("Unsafe tool bundle path: " + path);
    }
    if (typeof content !== "string" || content.length > 200_000) throw new Error("Invalid or oversized tool source: " + path);
    output[path] = content;
  }
  return output;
}

async function digestFiles(files: Record<string, string>): Promise<string> {
  const canonical = Object.keys(files).sort().map(path => path + "\0" + files[path]).join("\0");
  const bytes = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
}

function cloneSpec(spec: ToolBuildSpec): ToolBuildSpec {
  return { ...spec, specialists: [...spec.specialists], requirements: [...spec.requirements] };
}
function cloneArtifact(artifact: ToolArtifact): ToolArtifact {
  return { ...artifact, spec: cloneSpec(artifact.spec), files: { ...artifact.files },
    testSummary: artifact.testSummary ? cloneTestSummary(artifact.testSummary) : undefined };
}
function cloneTestSummary(summary: ToolTestSummary): ToolTestSummary {
  return { ...summary, findings: [...summary.findings] };
}
function descriptorCopy(descriptor: ToolDescriptor): ToolDescriptor {
  return { ...descriptor, specialists: [...descriptor.specialists] };
}
function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "unknown sandbox error";
}

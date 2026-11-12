/**
 * Director capability hub.
 *
 * Provides typed, host-injected ports for research, project inspection,
 * memory evolution proposals, and user-approved device operations.
 * This package never performs raw network, filesystem, process, or OS access.
 * All adapters are untrusted boundaries and all consequential device actions
 * require a fresh, narrowly scoped user approval.
 */
import type { MemoryManager, MemoryEntry } from "../memory/MemoryManager";

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  retrievedAt: string;
}

export interface ResearchRequest {
  query: string;
  allowedDomains?: string[];
  maxSources?: number;
}

export interface ResearchProvider {
  search(request: ResearchRequest): Promise<ResearchSource[]>;
}

export interface ProjectFinding {
  id: string;
  category: "missing-capability" | "defect" | "risk" | "optimization" | "dependency";
  title: string;
  detail: string;
  evidenceRefs: string[];
  priority: "low" | "medium" | "high" | "critical";
}

export interface ProjectAnalysis {
  summary: string;
  findings: ProjectFinding[];
  inspectedAt: string;
}

export interface ProjectInspector {
  inspect(input: { objective: string; paths?: string[] }): Promise<ProjectAnalysis>;
}

export interface MemoryImprovementProposal {
  id: string;
  rationale: string;
  changes: Array<{
    operation: "add" | "revise" | "retire";
    layer: MemoryEntry["layer"];
    memoryId?: string;
    content: string;
    sourceRefs: string[];
  }>;
}

export interface MemoryImprovementAdvisor {
  propose(input: {
    objective: string;
    currentMemories: MemoryEntry[];
    research: ResearchSource[];
    project: ProjectAnalysis;
  }): Promise<MemoryImprovementProposal>;
}

export interface MemoryChangeApproval {
  /** Approval must be bound to the exact task and SHA-256 of the immutable proposed change. */
  verify(input: {
    taskId: string;
    proposalId: string;
    changeIndex: number;
    changeDigest: string;
    approvalRef: string;
  }): boolean | Promise<boolean>;
}

export type DevicePermission =
  | "apps.list"
  | "apps.open"
  | "storage.inspect"
  | "files.read"
  | "files.write"
  | "files.delete";

export type DeviceAction =
  | { kind: "list-apps" }
  | { kind: "open-app"; appId: string }
  | { kind: "inspect-storage" }
  | { kind: "read-file"; fileId: string }
  | { kind: "write-file"; fileId: string; content: string }
  | { kind: "delete-file"; fileId: string; confirmDestructive: true };

export interface DeviceApproval {
  approvalRef: string;
  taskId: string;
  permission: DevicePermission;
  resourceId?: string;
  actionDigest: string;
}

export interface DevicePermissionBroker {
  /** Verify a current, user-granted permission for this exact action/resource. */
  authorize(input: DeviceApproval): boolean | Promise<boolean>;
}

export interface DeviceBridge {
  /** Host adapter must enforce OS sandboxing and resource allowlists. */
  perform(action: DeviceAction): Promise<unknown>;
}

export interface DirectorCapabilityOptions {
  research?: ResearchProvider;
  projectInspector?: ProjectInspector;
  memory: MemoryManager;
  memoryAdvisor?: MemoryImprovementAdvisor;
  memoryApproval?: MemoryChangeApproval;
  devicePermissionBroker?: DevicePermissionBroker;
  deviceBridge?: DeviceBridge;
}

export class DirectorCapabilities {
  constructor(private readonly options: DirectorCapabilityOptions) {}

  async research(request: ResearchRequest): Promise<ResearchSource[]> {
    if (!this.options.research) throw new Error("Internet research provider is not configured");
    if (!request || typeof request.query !== "string" || !request.query.trim()) {
      throw new Error("A research query is required");
    }
    const maxSources = request.maxSources ?? 8;
    if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > 20) {
      throw new Error("maxSources must be between 1 and 20");
    }
    const allowedDomains = request.allowedDomains === undefined
      ? undefined
      : normalizeAllowedDomains(request.allowedDomains);
    const sources = await this.options.research.search({
      query: request.query.trim(), maxSources, ...(allowedDomains ? { allowedDomains } : {})
    });
    if (!Array.isArray(sources)) throw new Error("Research provider returned an invalid result");
    return sources.slice(0, maxSources).map(source => {
      let url: URL;
      try { url = new URL(source?.url); } catch { throw new Error("Research provider returned an invalid or unsafe source"); }
      if (!source || typeof source.id !== "string" || typeof source.title !== "string" ||
          typeof source.excerpt !== "string" || !["http:", "https:"].includes(url.protocol) ||
          url.username || url.password ||
          typeof source.retrievedAt !== "string" || !Number.isFinite(Date.parse(source.retrievedAt))) {
        throw new Error("Research provider returned an invalid or unsafe source");
      }
      if (allowedDomains && !allowedDomains.some(domain => url.hostname.toLowerCase() === domain ||
          url.hostname.toLowerCase().endsWith("." + domain))) {
        throw new Error("Research provider returned a source outside the allowed domain list");
      }
      return { ...source, title: source.title.slice(0, 500), excerpt: source.excerpt.slice(0, 8000) };
    });
  }

  async analyzeProject(input: { objective: string; paths?: string[] }): Promise<ProjectAnalysis> {
    if (!this.options.projectInspector) throw new Error("Project inspection adapter is not configured");
    if (!input?.objective?.trim()) throw new Error("Project analysis objective is required");
    const paths = validateProjectPaths(input.paths);
    const result = await this.options.projectInspector.inspect({ objective: input.objective, ...(paths ? { paths } : {}) });
    if (!result || typeof result.summary !== "string" || !Array.isArray(result.findings)) {
      throw new Error("Project inspector returned an invalid analysis");
    }
    return { ...result, findings: result.findings.map(finding => ({ ...finding, evidenceRefs: [...finding.evidenceRefs] })) };
  }

  async proposeMemoryImprovements(input: {
    objective: string;
    research: ResearchSource[];
    project: ProjectAnalysis;
  }): Promise<MemoryImprovementProposal> {
    if (!this.options.memoryAdvisor) throw new Error("Memory improvement advisor is not configured");
    if (!input?.objective?.trim()) throw new Error("Memory improvement objective is required");
    const objective = input.objective;
    const research = input.research.map(source => ({ ...source }));
    const project = {
      ...input.project,
      findings: input.project.findings.map(finding => ({ ...finding, evidenceRefs: [...finding.evidenceRefs] }))
    };
    const proposal = await this.options.memoryAdvisor.propose({
      objective,
      currentMemories: this.options.memory.list().map(cloneMemoryEntry),
      research,
      project
    });
    validateMemoryProposal(proposal);
    return cloneMemoryProposal(proposal);
  }

  /** Apply one proposed memory change only after independent approval. */
  async applyMemoryImprovement(input: {
    proposal: MemoryImprovementProposal;
    changeIndex: number;
    approvalRef: string;
    taskId: string;
  }): Promise<string | boolean> {
    // Snapshot the entire approval subject before any await. The verifier and
    // the mutation below operate on this exact immutable copy, never caller data.
    const taskId = input.taskId;
    const approvalRef = input.approvalRef;
    const changeIndex = input.changeIndex;
    const proposal = cloneMemoryProposal(input.proposal);
    validateMemoryProposal(proposal);
    const change = proposal.changes[changeIndex];
    if (!change || !taskId?.trim() || !approvalRef?.trim()) throw new Error("A valid change, task id, and approval reference are required");
    const changeDigest = await digestJson({ taskId, proposalId: proposal.id, rationale: proposal.rationale, changeIndex, change });
    if (!this.options.memoryApproval || !await this.options.memoryApproval.verify({
      taskId, proposalId: proposal.id, changeIndex, changeDigest, approvalRef
    })) throw new Error("Memory change approval was denied");
    if (change.operation === "add") {
      return this.options.memory.write({
        layer: change.layer,
        content: change.content,
        provenance: { agentId: "director", taskId, verified: false, sourceRefs: [...change.sourceRefs] }
      });
    }
    if (!change.memoryId) throw new Error("A memory id is required for revise or retire");
    if (change.operation === "revise") {
      return this.options.memory.update(change.memoryId, { content: change.content, sourceRefs: [...change.sourceRefs] });
    }
    return this.options.memory.delete(change.memoryId);
  }

  /** Every call is permission-checked; destructive actions require explicit confirmation. */
  async useDevice(input: { taskId: string; approvalRef: string; action: DeviceAction }): Promise<unknown> {
    if (!this.options.deviceBridge || !this.options.devicePermissionBroker) {
      throw new Error("Permission-controlled device bridge is not configured");
    }
    if (!input?.taskId?.trim() || !input.approvalRef?.trim() || !input.action) {
      throw new Error("Task, approval, and device action are required");
    }
    const taskId = input.taskId;
    const approvalRef = input.approvalRef;
    // Normalize and freeze before awaiting the broker. This drops unrelated
    // caller fields and prevents action/resource mutation during authorization.
    const action = normalizeDeviceAction(input.action);
    const permission = permissionFor(action);
    const resourceId = resourceFor(action);
    const actionDigest = await digestJson(action);
    const approved = await this.options.devicePermissionBroker.authorize({
      taskId, approvalRef, permission, resourceId, actionDigest
    });
    if (approved !== true) throw new Error("Device permission was denied");
    return this.options.deviceBridge.perform(action);
  }
}

function normalizeAllowedDomains(input: string[]): string[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 30) {
    throw new Error("allowedDomains must contain 1–30 hostnames");
  }
  const domains = input.map(domain => {
    if (typeof domain !== "string") throw new Error("allowedDomains must contain hostnames");
    const normalized = domain.trim().toLowerCase().replace(/\\.$/, "");
    if (!normalized || normalized.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
      throw new Error("allowedDomains must contain valid hostnames");
    }
    return normalized;
  });
  return [...new Set(domains)];
}

function validateProjectPaths(input?: string[]): string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 100 || input.some(path =>
    typeof path !== "string" || !path.trim() || path.length > 1024 || path.startsWith("/") ||
    path.split(/[\\/]/).includes("..") || path.includes("\\0"))) {
    throw new Error("Project paths must be bounded relative paths without traversal segments");
  }
  return [...input];
}

function permissionFor(action: DeviceAction): DevicePermission {
  switch (action.kind) {
    case "list-apps": return "apps.list";
    case "open-app": return "apps.open";
    case "inspect-storage": return "storage.inspect";
    case "read-file": return "files.read";
    case "write-file": return "files.write";
    case "delete-file": return "files.delete";
    default: throw new Error("Unsupported device action");
  }
}

function normalizeDeviceAction(input: unknown): DeviceAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid device action");
  const action = input as Record<string, unknown>;
  switch (action.kind) {
    case "list-apps":
      return Object.freeze({ kind: "list-apps" });
    case "inspect-storage":
      return Object.freeze({ kind: "inspect-storage" });
    case "open-app":
      return Object.freeze({ kind: "open-app", appId: requireResource(action.appId, "appId") });
    case "read-file":
      return Object.freeze({ kind: "read-file", fileId: requireResource(action.fileId, "fileId") });
    case "write-file":
      if (typeof action.content !== "string" || action.content.length > 1_000_000) {
        throw new Error("Invalid or oversized device file content");
      }
      return Object.freeze({ kind: "write-file", fileId: requireResource(action.fileId, "fileId"), content: action.content });
    case "delete-file":
      if (action.confirmDestructive !== true) throw new Error("File deletion requires explicit destructive confirmation");
      return Object.freeze({ kind: "delete-file", fileId: requireResource(action.fileId, "fileId"), confirmDestructive: true });
    default:
      throw new Error("Unsupported device action");
  }
}

function requireResource(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw new Error("Device action requires a valid " + name);
  }
  return value;
}

function resourceFor(action: DeviceAction): string | undefined {
  switch (action.kind) {
    case "open-app": return action.appId;
    case "read-file":
    case "write-file":
    case "delete-file": return action.fileId;
    case "list-apps":
    case "inspect-storage": return undefined;
  }
}

async function digestJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function cloneMemoryEntry(entry: MemoryEntry): MemoryEntry {
  return {
    ...entry,
    provenance: { ...entry.provenance, sourceRefs: [...entry.provenance.sourceRefs] }
  };
}

function cloneMemoryProposal(proposal: MemoryImprovementProposal): MemoryImprovementProposal {
  return {
    id: proposal.id,
    rationale: proposal.rationale,
    changes: proposal.changes.map(change => ({
      operation: change.operation,
      layer: change.layer,
      ...(change.memoryId === undefined ? {} : { memoryId: change.memoryId }),
      content: change.content,
      sourceRefs: [...change.sourceRefs]
    }))
  };
}

function validateMemoryProposal(proposal: MemoryImprovementProposal): void {
  if (!proposal || typeof proposal.id !== "string" || !proposal.id.trim() ||
      typeof proposal.rationale !== "string" || !Array.isArray(proposal.changes) ||
      proposal.changes.length < 1 || proposal.changes.length > 20) {
    throw new Error("Invalid memory improvement proposal");
  }
  for (const change of proposal.changes) {
    if (!change || !["add", "revise", "retire"].includes(change.operation) ||
        !["working", "episodic", "semantic", "procedural"].includes(change.layer) ||
        typeof change.content !== "string" || !change.content.trim() ||
        (change.memoryId !== undefined && (typeof change.memoryId !== "string" || !change.memoryId.trim())) ||
        ((change.operation === "revise" || change.operation === "retire") && !change.memoryId) ||
        !Array.isArray(change.sourceRefs) || change.sourceRefs.some(ref => typeof ref !== "string" || !ref.trim())) {
      throw new Error("Invalid memory improvement change");
    }
  }
}

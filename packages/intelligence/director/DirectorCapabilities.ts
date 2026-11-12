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
  verify(input: { proposalId: string; changeIndex: number; approvalRef: string }): boolean | Promise<boolean>;
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
    const sources = await this.options.research.search({ ...request, query: request.query.trim(), maxSources });
    if (!Array.isArray(sources)) throw new Error("Research provider returned an invalid result");
    return sources.slice(0, maxSources).map(source => {
      if (!source || typeof source.id !== "string" || typeof source.title !== "string" ||
          typeof source.excerpt !== "string" || typeof source.url !== "string" ||
          !["http:", "https:"].includes(new URL(source.url).protocol) ||
          typeof source.retrievedAt !== "string" || !Number.isFinite(Date.parse(source.retrievedAt))) {
        throw new Error("Research provider returned an invalid or unsafe source");
      }
      return { ...source, title: source.title.slice(0, 500), excerpt: source.excerpt.slice(0, 8000) };
    });
  }

  async analyzeProject(input: { objective: string; paths?: string[] }): Promise<ProjectAnalysis> {
    if (!this.options.projectInspector) throw new Error("Project inspection adapter is not configured");
    if (!input?.objective?.trim()) throw new Error("Project analysis objective is required");
    const result = await this.options.projectInspector.inspect(input);
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
    const proposal = await this.options.memoryAdvisor.propose({
      objective: input.objective,
      currentMemories: this.options.memory.list(),
      research: input.research.map(source => ({ ...source })),
      project: { ...input.project, findings: input.project.findings.map(finding => ({ ...finding, evidenceRefs: [...finding.evidenceRefs] })) }
    });
    validateMemoryProposal(proposal);
    return proposal;
  }

  /** Apply one proposed memory change only after independent approval. */
  async applyMemoryImprovement(input: {
    proposal: MemoryImprovementProposal;
    changeIndex: number;
    approvalRef: string;
    taskId: string;
  }): Promise<string | boolean> {
    const { proposal, changeIndex, approvalRef, taskId } = input;
    validateMemoryProposal(proposal);
    const change = proposal.changes[changeIndex];
    if (!change || !taskId?.trim() || !approvalRef?.trim()) throw new Error("A valid change, task id, and approval reference are required");
    if (!this.options.memoryApproval || !await this.options.memoryApproval.verify({
      proposalId: proposal.id, changeIndex, approvalRef
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
      return this.options.memory.update(change.memoryId, { content: change.content, sourceRefs: change.sourceRefs });
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
    validateDeviceAction(input.action);
    const permission = permissionFor(input.action);
    const resourceId = "appId" in input.action ? input.action.appId : "fileId" in input.action ? input.action.fileId : undefined;
    const approved = await this.options.devicePermissionBroker.authorize({
      taskId: input.taskId, approvalRef: input.approvalRef, permission, resourceId
    });
    if (approved !== true) throw new Error("Device permission was denied");
    if (input.action.kind === "delete-file" && input.action.confirmDestructive !== true) {
      throw new Error("File deletion requires explicit destructive confirmation");
    }
    return this.options.deviceBridge.perform({ ...input.action } as DeviceAction);
  }
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

function validateDeviceAction(action: DeviceAction): void {
  if (!action || typeof action !== "object" || typeof action.kind !== "string") throw new Error("Invalid device action");
  const resource = "appId" in action ? action.appId : "fileId" in action ? action.fileId : undefined;
  if (resource !== undefined && (typeof resource !== "string" || !resource.trim() || resource.length > 512)) {
    throw new Error("Invalid device resource identifier");
  }
  if (action.kind === "write-file" && (typeof action.content !== "string" || action.content.length > 1_000_000)) {
    throw new Error("Invalid or oversized device file content");
  }
  if (action.kind === "delete-file" && action.confirmDestructive !== true) {
    throw new Error("File deletion requires explicit destructive confirmation");
  }
  if (!["list-apps", "open-app", "inspect-storage", "read-file", "write-file", "delete-file"].includes(action.kind)) {
    throw new Error("Unsupported device action");
  }
}

function validateMemoryProposal(proposal: MemoryImprovementProposal): void {
  if (!proposal || typeof proposal.id !== "string" || !proposal.id.trim() ||
      typeof proposal.rationale !== "string" || !Array.isArray(proposal.changes) ||
      proposal.changes.length < 1 || proposal.changes.length > 20) {
    throw new Error("Invalid memory improvement proposal");
  }
  for (const change of proposal.changes) {
    if (!["add", "revise", "retire"].includes(change.operation) ||
        !["working", "episodic", "semantic", "procedural"].includes(change.layer) ||
        typeof change.content !== "string" || !change.content.trim() ||
        !Array.isArray(change.sourceRefs) || change.sourceRefs.some(ref => typeof ref !== "string")) {
      throw new Error("Invalid memory improvement change");
    }
  }
}

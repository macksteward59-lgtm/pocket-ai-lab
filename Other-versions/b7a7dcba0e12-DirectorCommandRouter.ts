/**
 * Strict structured-command bridge for the Director.
 *
 * Model output is treated as untrusted JSON proposal data. Only this finite
 * command vocabulary is accepted; arbitrary code, shell commands, URLs to
 * fetch directly, and free-form tool names are never executed here.
 * Consequential commands still delegate to approval-enforcing capability ports.
 */
import type {
  DirectorCapabilities, ResearchSource, ProjectAnalysis, MemoryImprovementProposal
} from "./DirectorCapabilities";
import type { ToolDirector, ToolBuildSpec } from "../tooling/ToolDirector";
import type { AgentLearningTool, LearningChangeKind, TrainingBudget } from "../learning/AgentLearningTool";

export type DirectorCommand =
  | { kind: "research"; query: string; allowedDomains?: string[]; maxSources?: number }
  | { kind: "analyze-project"; objective: string; paths?: string[] }
  | { kind: "propose-memory-improvements"; objective: string; research: ResearchSource[]; project: ProjectAnalysis }
  | { kind: "apply-memory-improvement"; proposal: MemoryImprovementProposal; changeIndex: number; approvalRef: string }
  | { kind: "develop-tool"; spec: ToolBuildSpec }
  | { kind: "activate-tool"; toolId: string; version: number; approvalRef: string }
  | { kind: "retire-tool"; toolId: string; approvalRef: string }
  | { kind: "use-device"; approvalRef: string; action: Parameters<DirectorCapabilities["useDevice"]>[0]["action"] }
  | { kind: "propose-agent-learning"; agentId: string; objective: string; changeKind: LearningChangeKind; evidenceRefs: string[] }
  | { kind: "train-agent-candidate"; proposalId: string; baselineModelId: string; datasetRef: string; datasetVersion: string; budget: TrainingBudget; hyperparameters: Record<string, string | number | boolean>; approvalRef: string }
  | { kind: "evaluate-agent-candidate"; candidateId: string; benchmarkVersion: string };

export interface DirectorCommandContext {
  taskId: string;
}

/**
 * Provider-neutral port. Host adapters translate this into native model
 * function/tool calling and return the untrusted structured proposal.
 */
export interface DirectorCommandProvider {
  propose(input: {
    taskId: string;
    objective: string;
    availableCommands: readonly string[];
  }): Promise<unknown>;
}

export const DIRECTOR_COMMAND_KINDS = [
  "research", "analyze-project", "propose-memory-improvements",
  "apply-memory-improvement", "develop-tool", "activate-tool",
  "retire-tool", "use-device", "propose-agent-learning", "train-agent-candidate",
  "evaluate-agent-candidate"
] as const;

/**
 * Canonical command argument allowlist shared by the router and provider
 * adapters. The satisfies constraint makes a newly added command fail
 * type-checking until its exact argument contract is declared here.
 */
export const DIRECTOR_COMMAND_FIELDS = {
  research: ["kind", "query", "allowedDomains", "maxSources"],
  "analyze-project": ["kind", "objective", "paths"],
  "propose-memory-improvements": ["kind", "objective", "research", "project"],
  "apply-memory-improvement": ["kind", "proposal", "changeIndex", "approvalRef"],
  "develop-tool": ["kind", "spec"],
  "activate-tool": ["kind", "toolId", "version", "approvalRef"],
  "retire-tool": ["kind", "toolId", "approvalRef"],
  "use-device": ["kind", "approvalRef", "action"],
  "propose-agent-learning": ["kind", "agentId", "objective", "changeKind", "evidenceRefs"],
  "train-agent-candidate": ["kind", "proposalId", "baselineModelId", "datasetRef", "datasetVersion", "budget", "hyperparameters", "approvalRef"],
  "evaluate-agent-candidate": ["kind", "candidateId", "benchmarkVersion"]
} as const satisfies Record<(typeof DIRECTOR_COMMAND_KINDS)[number], readonly string[]>;

export class DirectorCommandRouter {
  constructor(
    private readonly capabilities: DirectorCapabilities,
    private readonly tooling: ToolDirector,
    private readonly learning?: AgentLearningTool
  ) {}

  /** Ask the injected model adapter for one structured proposal, then validate and dispatch it. */
  async requestAndDispatch(
    provider: DirectorCommandProvider,
    context: DirectorCommandContext,
    objective: string
  ): Promise<unknown> {
    if (!provider || typeof provider.propose !== "function") throw new Error("Director command provider is not configured");
    if (!context?.taskId?.trim() || !objective?.trim()) throw new Error("Task id and objective are required");
    const proposal = await provider.propose({
      taskId: context.taskId,
      objective: objective.trim(),
      availableCommands: DIRECTOR_COMMAND_KINDS
    });
    return this.dispatch(context, proposal);
  }

  /** Validate first, then dispatch exactly one allowlisted command. */
  async dispatch(context: DirectorCommandContext, untrusted: unknown): Promise<unknown> {
    if (!context?.taskId?.trim()) throw new Error("A task id is required");
    const command = parseDirectorCommand(untrusted);
    switch (command.kind) {
      case "research":
        return this.capabilities.research(command);
      case "analyze-project":
        return this.capabilities.analyzeProject(command);
      case "propose-memory-improvements":
        return this.capabilities.proposeMemoryImprovements(command);
      case "apply-memory-improvement":
        return this.capabilities.applyMemoryImprovement({
          proposal: command.proposal,
          changeIndex: command.changeIndex,
          approvalRef: command.approvalRef,
          taskId: context.taskId
        });
      case "develop-tool":
        return this.tooling.develop(command.spec);
      case "activate-tool":
        return this.tooling.activate({
          taskId: context.taskId, toolId: command.toolId,
          version: command.version, approvalRef: command.approvalRef
        });
      case "retire-tool":
        return this.tooling.retire({
          taskId: context.taskId, toolId: command.toolId, approvalRef: command.approvalRef
        });
      case "use-device":
        return this.capabilities.useDevice({
          taskId: context.taskId, approvalRef: command.approvalRef, action: command.action
        });
      case "propose-agent-learning":
        if (!this.learning) throw new Error("Agent learning tool is not configured");
        return this.learning.propose({ ...command, taskId: context.taskId });
      case "train-agent-candidate":
        if (!this.learning) throw new Error("Agent learning tool is not configured");
        return this.learning.train({ ...command, taskId: context.taskId });
      case "evaluate-agent-candidate":
        if (!this.learning) throw new Error("Agent learning tool is not configured");
        return this.learning.evaluate(command);
    }
  }
}

/** Public validator is useful to provider adapters before dispatch. */
export function parseDirectorCommand(input: unknown): DirectorCommand {
  if (!isRecord(input) || typeof input.kind !== "string") throw new Error("Director command must be a structured object");
  const hasCommandContract = Object.prototype.hasOwnProperty.call(DIRECTOR_COMMAND_FIELDS, input.kind);
  const allowedFields: readonly string[] | undefined = hasCommandContract
    ? DIRECTOR_COMMAND_FIELDS[input.kind as keyof typeof DIRECTOR_COMMAND_FIELDS]
    : undefined;
  if (allowedFields && Object.keys(input).some(key => !allowedFields.includes(key))) {
    throw new Error("Director command contains fields outside the selected command contract");
  }
  switch (input.kind) {
    case "research":
      requireString(input.query, "query");
      if (input.allowedDomains !== undefined &&
          (!Array.isArray(input.allowedDomains) || input.allowedDomains.length > 30 ||
           input.allowedDomains.some(value => typeof value !== "string" || !/^[a-z0-9.-]+$/i.test(value)))) {
        throw new Error("allowedDomains must contain valid hostnames");
      }
      if (input.maxSources !== undefined && (!Number.isInteger(input.maxSources) || (input.maxSources as number) < 1 || (input.maxSources as number) > 20)) {
        throw new Error("maxSources must be between 1 and 20");
      }
      return input as unknown as DirectorCommand;
    case "analyze-project":
      requireString(input.objective, "objective");
      if (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.length > 100 ||
          input.paths.some(value => typeof value !== "string" || !value.trim() || value.startsWith("/") || value.split("/").includes("..")))) {
        throw new Error("paths must be a bounded list of relative project paths");
      }
      return input as unknown as DirectorCommand;
    case "propose-memory-improvements":
      requireString(input.objective, "objective");
      if (!Array.isArray(input.research) || !isRecord(input.project) ||
          typeof input.project.summary !== "string" || !Array.isArray(input.project.findings)) {
        throw new Error("Memory proposals require structured research and project evidence");
      }
      return input as unknown as DirectorCommand;
    case "apply-memory-improvement":
      requireRecord(input.proposal, "proposal");
      requireString(input.approvalRef, "approvalRef");
      if (!Number.isInteger(input.changeIndex) || (input.changeIndex as number) < 0) throw new Error("changeIndex must be a non-negative integer");
      return input as unknown as DirectorCommand;
    case "develop-tool":
      requireRecord(input.spec, "spec");
      return input as unknown as DirectorCommand;
    case "activate-tool":
      requireString(input.toolId, "toolId");
      requireString(input.approvalRef, "approvalRef");
      if (!Number.isInteger(input.version) || (input.version as number) < 1) throw new Error("version must be a positive integer");
      return input as unknown as DirectorCommand;
    case "retire-tool":
      requireString(input.toolId, "toolId");
      requireString(input.approvalRef, "approvalRef");
      return input as unknown as DirectorCommand;
    case "use-device":
      requireString(input.approvalRef, "approvalRef");
      requireRecord(input.action, "action");
      validateDeviceActionFields(input.action);
      return input as unknown as DirectorCommand;
    case "propose-agent-learning":
      requireString(input.agentId, "agentId");
      requireString(input.objective, "objective");
      if (!["prompt", "retrieval", "routing", "tool-workflow", "adapter-training"].includes(String(input.changeKind))) {
        throw new Error("Unsupported learning change kind");
      }
      if (!Array.isArray(input.evidenceRefs) || input.evidenceRefs.length < 1 || input.evidenceRefs.length > 50 ||
          input.evidenceRefs.some(value => typeof value !== "string" || !value.trim() || value.length > 2048)) {
        throw new Error("evidenceRefs must contain 1–50 bounded source references");
      }
      return input as unknown as DirectorCommand;
    case "train-agent-candidate":
      for (const field of ["proposalId", "baselineModelId", "datasetRef", "datasetVersion", "approvalRef"]) {
        requireString(input[field], field);
      }
      requireRecord(input.budget, "budget");
      requireRecord(input.hyperparameters, "hyperparameters");
      return input as unknown as DirectorCommand;
    case "evaluate-agent-candidate":
      requireString(input.candidateId, "candidateId");
      requireString(input.benchmarkVersion, "benchmarkVersion");
      return input as unknown as DirectorCommand;
    default:
      throw new Error("Unsupported Director command: " + input.kind);
  }
}

function requireString(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > 8000) throw new Error(name + " must be a non-empty bounded string");
}
function requireRecord(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new Error(name + " must be an object");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateDeviceActionFields(action: Record<string, unknown>): void {
  if (typeof action.kind !== "string") throw new Error("Unsupported device action");
  let allowed: readonly string[];
  switch (action.kind) {
    case "list-apps":
    case "inspect-storage":
      allowed = ["kind"];
      break;
    case "open-app":
      allowed = ["kind", "appId"];
      break;
    case "read-file":
      allowed = ["kind", "fileId"];
      break;
    case "write-file":
      allowed = ["kind", "fileId", "content"];
      break;
    case "delete-file":
      allowed = ["kind", "fileId", "confirmDestructive"];
      break;
    default:
      throw new Error("Unsupported device action");
  }
  if (Object.keys(action).some(key => !allowed.includes(key))) {
    throw new Error("Device action contains fields outside its selected action contract");
  }
}

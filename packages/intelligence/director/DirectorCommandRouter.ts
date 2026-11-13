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

export type DirectorCommand =
  | { kind: "research"; query: string; allowedDomains?: string[]; maxSources?: number }
  | { kind: "analyze-project"; objective: string; paths?: string[] }
  | { kind: "propose-memory-improvements"; objective: string; research: ResearchSource[]; project: ProjectAnalysis }
  | { kind: "apply-memory-improvement"; proposal: MemoryImprovementProposal; changeIndex: number; approvalRef: string }
  | { kind: "develop-tool"; spec: ToolBuildSpec }
  | { kind: "activate-tool"; toolId: string; version: number; approvalRef: string }
  | { kind: "retire-tool"; toolId: string; approvalRef: string }
  | { kind: "use-device"; approvalRef: string; action: Parameters<DirectorCapabilities["useDevice"]>[0]["action"] };

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
  "retire-tool", "use-device"
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
  "use-device": ["kind", "approvalRef", "action"]
} as const satisfies Record<(typeof DIRECTOR_COMMAND_KINDS)[number], readonly string[]>;

export class DirectorCommandRouter {
  constructor(
    private readonly capabilities: DirectorCapabilities,
    private readonly tooling: ToolDirector
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
    }
  }
}

/** Public validator is useful to provider adapters before dispatch. */
export function parseDirectorCommand(input: unknown): DirectorCommand {
  if (!isRecord(input) || typeof input.kind !== "string") throw new Error("Director command must be a structured object");
  const allowedFields: readonly string[] = DIRECTOR_COMMAND_FIELDS[input.kind as keyof typeof DIRECTOR_COMMAND_FIELDS];
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
      if (!["list-apps", "open-app", "inspect-storage", "read-file", "write-file", "delete-file"].includes(String(input.action.kind))) {
        throw new Error("Unsupported device action");
      }
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

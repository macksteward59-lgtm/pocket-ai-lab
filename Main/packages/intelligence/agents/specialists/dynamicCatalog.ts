/**
 * Dynamic specialist catalog: narrower, task-scoped roles created on demand.
 *
 * Each entry specializes one of the six base templates. A dynamic specialist
 * inherits the base template's capabilities and permissions and can never hold
 * more than the base ("lab" only). `skills` are capability ids from the skill
 * registry. Routing does not select these, and SecurityDivision.assemble does
 * not accept them. A catalog entry is not permission to execute anything.
 */
import type { SecuritySpecialistId } from "../AgentManager";

export interface DynamicSpecialistTemplate {
  base: SecuritySpecialistId;
  role: string;
  description: string;
  skills: string[];
}

export const DYNAMIC_SPECIALIST_CATALOG = {
  "azure-tenant-isolation": {
    base: "microsoft-cloud",
    role: "Azure Tenant Isolation Researcher",
    description: "Cross-tenant isolation boundaries in Azure",
    skills: ["tenant-isolation", "azure-architecture"]
  },
  "microsoft-graph-api": {
    base: "microsoft-cloud",
    role: "Microsoft Graph API Researcher",
    description: "Microsoft Graph API authorization and exposure review",
    skills: ["api-security", "entra-id-assessment"]
  },
  "windows-kernel-driver": {
    base: "windows-internals",
    role: "Windows Kernel Driver Analyst",
    description: "Windows kernel driver architecture and attack-surface analysis",
    skills: ["windows-driver-analysis", "kernel-analysis"]
  },
  "hyperv-security": {
    base: "windows-internals",
    role: "Hyper-V Security Researcher",
    description: "Hyper-V and virtualization isolation research in the lab",
    skills: ["hyperv-isolation-research"]
  },
  "chromium-v8": {
    base: "ai-security",
    role: "Chromium/V8 Vulnerability Researcher",
    description: "Chromium sandbox architecture and V8 engine security",
    skills: ["browser-security"]
  },
  "powershell-automation": {
    base: "windows-internals",
    role: "PowerShell Automation Specialist",
    description: "Authoring and reviewing PowerShell research automation",
    skills: ["automation-foundations"]
  },
  "dotnet-security": {
    base: "reverse-engineering",
    role: ".NET Security Researcher",
    description: ".NET code and assembly security review",
    skills: ["programming-foundations", "binary-static-analysis"]
  },
  "copilot-indirect-prompt-injection": {
    base: "ai-security",
    role: "Copilot Indirect Prompt-Injection Researcher",
    description: "Indirect prompt-injection exposure in Copilot-style surfaces",
    skills: ["indirect-prompt-injection-analysis", "copilot-surface-review"]
  }
} satisfies Record<string, DynamicSpecialistTemplate>;

export type DynamicSpecialistId = keyof typeof DYNAMIC_SPECIALIST_CATALOG;

export const GOVERNANCE_ADVISORY_INVARIANT =
  "You are a non-executing, passive governance advisory agent. You are forbidden from drafting working exploit tools, weaponized scripts, or execution payloads. Your sole objective is to analyze threat metadata and provide structured remediation documentation.";

export function withGovernanceInvariant(task: string): string {
  return GOVERNANCE_ADVISORY_INVARIANT + "\n\n" + task.trim();
}

export function specialistPrompt(id: DynamicSpecialistId, task: string): string {
  const spec = DYNAMIC_SPECIALIST_CATALOG[id];
  return withGovernanceInvariant("Role: " + spec.role + "\n" + spec.description + "\nTask: " + task.trim());
}

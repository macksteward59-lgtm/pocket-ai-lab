/**
 * Tool registry. Metadata only: it describes tools and which specialists may
 * even request them. It never launches a tool and holds no command lines.
 *
 * Availability is separate from permission. Declaring a tool installed does
 * not authorize anyone to use it, and a registry allowlist entry does not
 * either: every request still needs a delegation voucher (and, for "active"
 * tools, verified human approval). Installing a tool never authorizes it.
 *
 * This module does not import a process runner and has no execute method.
 * Offensive assessment toolkits (including MicroBurst and GraphRunner) are
 * intentionally absent. A catalog name is not a capability to run one.
 */
import type { SecuritySpecialistId } from "../agents/AgentManager";

/**
 * "analysis": works on artifacts offline (e.g. a disassembler).
 * "active": interacts with live systems or can run arbitrary code, so it needs
 * human approval in addition to a voucher.
 */
export type ToolMode = "analysis" | "active";

export interface ToolDescriptor {
  id: string;
  name: string;
  application: string;
  mode: ToolMode;
  /** Specialists that may request this tool at all. */
  specialists: SecuritySpecialistId[];
}

const ALL: SecuritySpecialistId[] = [
  "microsoft-cloud", "identity-security", "windows-internals", "reverse-engineering", "ai-security", "network-protocols"
];

export const TOOL_CATALOG: ToolDescriptor[] = [
  { id: "burp-suite", name: "Burp Suite Professional", application: "Web/API traffic analysis", mode: "active", specialists: ["identity-security", "microsoft-cloud", "ai-security"] },
  { id: "owasp-zap", name: "OWASP ZAP", application: "Automated web security testing", mode: "active", specialists: ["identity-security", "microsoft-cloud", "ai-security"] },
  { id: "ghidra", name: "Ghidra", application: "Binary reverse engineering", mode: "analysis", specialists: ["reverse-engineering", "windows-internals"] },
  { id: "ida-pro", name: "IDA Pro", application: "Advanced binary analysis", mode: "analysis", specialists: ["reverse-engineering", "windows-internals"] },
  { id: "radare2", name: "Radare2", application: "Binary reverse engineering", mode: "analysis", specialists: ["reverse-engineering"] },
  { id: "windbg", name: "WinDbg", application: "Windows debugging", mode: "active", specialists: ["windows-internals", "reverse-engineering"] },
  { id: "sysinternals", name: "Sysinternals", application: "Windows diagnostics", mode: "active", specialists: ["windows-internals"] },
  { id: "powershell", name: "PowerShell", application: "Windows administration and automation", mode: "active", specialists: ["microsoft-cloud", "windows-internals"] },
  { id: "python", name: "Python", application: "Research and testing automation", mode: "active", specialists: ALL }
];

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDescriptor>();
  private readonly available = new Set<string>();

  constructor(catalog: ToolDescriptor[] = TOOL_CATALOG) {
    for (const tool of catalog) {
      if (!tool.id?.trim()) throw new Error("Tool id is required");
      if (this.tools.has(tool.id)) throw new Error("Tool already registered: " + tool.id);
      this.tools.set(tool.id, { ...tool, specialists: [...tool.specialists] });
    }
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  get(id: string): ToolDescriptor | undefined {
    const tool = this.tools.get(id);
    return tool ? { ...tool, specialists: [...tool.specialists] } : undefined;
  }

  list(): ToolDescriptor[] {
    return [...this.tools.keys()].map(id => this.get(id)!);
  }

  /** Whether this specialist template may request the tool. Says nothing about permission to use it. */
  mayRequest(specialist: SecuritySpecialistId, toolId: string): boolean {
    return this.tools.get(toolId)?.specialists.includes(specialist) ?? false;
  }

  /** Host calls this after detecting an installation. No tool is available by default. */
  declareAvailable(id: string): void {
    if (!this.tools.has(id)) throw new Error("Unknown tool: " + id);
    this.available.add(id);
  }

  declareUnavailable(id: string): void {
    this.available.delete(id);
  }

  isAvailable(id: string): boolean {
    return this.available.has(id);
  }
}

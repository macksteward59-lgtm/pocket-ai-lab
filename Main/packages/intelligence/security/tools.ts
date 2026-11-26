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
 * "analysis": reads artifacts already on disk, such as a disassembly database
 * or an administrator-supplied posture export. It does not call a cloud API.
 * "active": reserved for a host-supplied registry. The default catalog has
 * no active tools, no scanners, and no code runners.
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

export const TOOL_CATALOG: ToolDescriptor[] = [
  {
    id: "posture-export",
    name: "Posture export",
    application: "Parse an administrator-supplied JSON or CSV configuration export. Does not call a cloud API and does not run a scan.",
    mode: "analysis",
    specialists: ["microsoft-cloud", "identity-security"]
  },
  { id: "ghidra", name: "Ghidra", application: "Binary reverse engineering", mode: "analysis", specialists: ["reverse-engineering", "windows-internals"] },
  { id: "ida-pro", name: "IDA Pro", application: "Advanced binary analysis", mode: "analysis", specialists: ["reverse-engineering", "windows-internals"] },
  { id: "radare2", name: "Radare2", application: "Binary reverse engineering", mode: "analysis", specialists: ["reverse-engineering"] }
];

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDescriptor>();
  private readonly available = new Set<string>();
  private readonly managed = new Set<string>();

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

  /** Registers metadata for a Director-built tool. This never installs or executes code. */
  registerManaged(tool: ToolDescriptor): void {
    if (!tool.id?.trim()) throw new Error("Tool id is required");
    if (this.tools.has(tool.id)) throw new Error("Tool already registered: " + tool.id);
    this.tools.set(tool.id, { ...tool, specialists: [...tool.specialists] });
    this.managed.add(tool.id);
  }

  /** Updates only tools created through registerManaged; built-in catalog entries are protected. */
  replaceManaged(tool: ToolDescriptor): void {
    if (!this.managed.has(tool.id)) throw new Error("Tool is not Director-managed: " + tool.id);
    this.tools.set(tool.id, { ...tool, specialists: [...tool.specialists] });
    // A new active artifact digest is not the previously installed adapter.
    // The host must re-install or re-verify the replacement before use.
    this.available.delete(tool.id);
  }

  isManaged(id: string): boolean {
    return this.managed.has(id);
  }

  /** Removes only Director-managed metadata, never built-in catalog entries. */
  unregisterManaged(id: string): boolean {
    if (!this.managed.has(id)) return false;
    this.managed.delete(id);
    this.available.delete(id);
    return this.tools.delete(id);
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

import { describe, expect, it } from "vitest";
import { ToolRegistry, TOOL_CATALOG } from "../security/tools";

describe("ToolRegistry", () => {
  it("loads the default catalog and reports who may request each tool", () => {
    const registry = new ToolRegistry();
    expect(registry.list().length).toBe(TOOL_CATALOG.length);
    expect(registry.mayRequest("reverse-engineering", "ghidra")).toBe(true);
    expect(registry.mayRequest("network-protocols", "ghidra")).toBe(false);
    expect(registry.mayRequest("microsoft-cloud", "unknown-tool")).toBe(false);
    const ids = registry.list().map(tool => tool.id);
    expect(ids).not.toContain("microburst");
    expect(ids).not.toContain("graphrunner");
    expect("execute" in registry).toBe(false);
  });

  it("rejects duplicate or empty tool ids at construction", () => {
    const one = { id: "x", name: "X", application: "test", mode: "analysis" as const, specialists: [] };
    expect(() => new ToolRegistry([one, one])).toThrow(/already registered/);
    expect(() => new ToolRegistry([{ ...one, id: "" }])).toThrow(/id is required/);
  });

  it("tracks availability independently of permission to request", () => {
    const registry = new ToolRegistry();
    expect(registry.isAvailable("ghidra")).toBe(false);
    registry.declareAvailable("ghidra");
    expect(registry.isAvailable("ghidra")).toBe(true);
    expect(() => registry.declareAvailable("not-a-tool")).toThrow(/Unknown tool/);
    registry.declareUnavailable("ghidra");
    expect(registry.isAvailable("ghidra")).toBe(false);
    // Declaring availability never implies anyone may request it.
    registry.declareAvailable("ghidra");
    expect(registry.mayRequest("network-protocols", "ghidra")).toBe(false);
  });

  it("returns defensive copies of tool descriptors", () => {
    const registry = new ToolRegistry();
    const tool = registry.get("ghidra")!;
    tool.specialists.push("network-protocols" as never);
    expect(registry.get("ghidra")!.specialists).not.toContain("network-protocols");
  });
});

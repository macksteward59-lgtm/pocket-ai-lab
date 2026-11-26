import { describe, expect, it } from "vitest";
import { SkillRegistry } from "../skills/SkillRegistry";
import { createDefaultSkillRegistry, SKILL_CATALOG } from "../skills/catalog";
import { SECURITY_SPECIALIST_IDS } from "../agents/AgentManager";
import { DYNAMIC_SPECIALIST_CATALOG } from "../agents/specialists/dynamicCatalog";

describe("SkillRegistry", () => {
  it("rejects a skill with an invalid id, missing title, bad layer, or empty knowledge", () => {
    const base = { title: "T", layer: 1 as const, knowledge: ["x"], specialists: [], coreAgents: ["engineer"], ecosystem: "general" as const, labOnly: false };
    expect(() => new SkillRegistry([{ ...base, id: "Bad Id" }])).toThrow(/kebab-case/);
    expect(() => new SkillRegistry([{ ...base, id: "ok", title: " " }])).toThrow(/title/);
    expect(() => new SkillRegistry([{ ...base, id: "ok", layer: 9 as never }])).toThrow(/layer/);
    expect(() => new SkillRegistry([{ ...base, id: "ok", knowledge: [] }])).toThrow(/knowledge/);
    expect(() => new SkillRegistry([{ ...base, id: "ok", specialists: [], coreAgents: [] }])).toThrow(/held by at least one agent/);
  });

  it("rejects an unknown specialist or core agent owner, and duplicate ids", () => {
    const base = { title: "T", layer: 1 as const, knowledge: ["x"], ecosystem: "general" as const, labOnly: false };
    expect(() => new SkillRegistry([{ ...base, id: "a", specialists: ["not-real" as never], coreAgents: [] }])).toThrow(/unknown specialist/);
    expect(() => new SkillRegistry([{ ...base, id: "a", specialists: [], coreAgents: ["not-real"] }])).toThrow(/unknown core agent/);
    expect(() => new SkillRegistry([
      { ...base, id: "a", specialists: ["identity-security"], coreAgents: [] },
      { ...base, id: "a", specialists: ["identity-security"], coreAgents: [] }
    ])).toThrow(/already registered/);
  });

  it("loads the default catalog cleanly and covers every specialist", () => {
    const registry = createDefaultSkillRegistry();
    for (const id of SECURITY_SPECIALIST_IDS) {
      expect(registry.skillIdsFor(id).length).toBeGreaterThan(0);
    }
    expect(registry.list().length).toBe(SKILL_CATALOG.length);
    for (const template of Object.values(DYNAMIC_SPECIALIST_CATALOG)) {
      expect(SECURITY_SPECIALIST_IDS).toContain(template.base);
      for (const skillId of template.skills) expect(registry.has(skillId)).toBe(true);
    }
  });

  it("filters by layer, ecosystem, specialist, coreAgent, and labOnly", () => {
    const registry = createDefaultSkillRegistry();
    expect(registry.list({ layer: 1 }).every(s => s.layer === 1)).toBe(true);
    expect(registry.list({ ecosystem: "microsoft" }).every(s => s.ecosystem === "microsoft")).toBe(true);
    expect(registry.list({ specialist: "reverse-engineering" }).every(s => s.specialists.includes("reverse-engineering"))).toBe(true);
    expect(registry.list({ labOnly: true }).every(s => s.labOnly)).toBe(true);
    expect(registry.list({ coreAgent: "engineer" }).every(s => s.coreAgents.includes("engineer"))).toBe(true);
  });

  it("finds skills covering a topic case-insensitively", () => {
    const registry = createDefaultSkillRegistry();
    expect(registry.skillsCoveringTopic("jwt security")).toContain("jwt-verification");
    expect(registry.skillsCoveringTopic("JWT SECURITY")).toContain("jwt-verification");
    expect(registry.skillsCoveringTopic("nonexistent topic")).toEqual([]);
  });

  it("throws ownersOf for an unknown skill and returns owners for a known one", () => {
    const registry = createDefaultSkillRegistry();
    expect(() => registry.ownersOf("not-a-skill")).toThrow(/Unknown skill/);
    const owners = registry.ownersOf("jwt-verification");
    expect(owners.specialists).toContain("identity-security");
  });

  it("returns defensive copies: mutating a returned skill does not affect the registry", () => {
    const registry = createDefaultSkillRegistry();
    const skill = registry.get("jwt-verification")!;
    skill.knowledge.push("tampered");
    expect(registry.get("jwt-verification")!.knowledge).not.toContain("tampered");
  });
});

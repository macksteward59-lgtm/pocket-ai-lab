import { describe, expect, it } from "vitest";
import { MemoryManager, type MemoryEntry } from "./MemoryManager";
import { rankMemories, tokenize } from "./relevance";

function entry(content: string): Omit<MemoryEntry, "id" | "createdAt"> {
  return { layer: "semantic", content, provenance: { agentId: "user", verified: false, sourceRefs: [] } };
}

describe("memory relevance", () => {
  it("drops stopwords and folds simple plurals", () => {
    expect(tokenize("What are my Projects about?")).toEqual(["project"]);
  });

  it("ranks the matching note first and ignores unrelated notes", async () => {
    const memory = new MemoryManager();
    await memory.write(entry("My coffee shop project is called Night Owl Roasters."));
    await memory.write(entry("I prefer TypeScript over Python for backend work."));
    await memory.write(entry("Dentist appointment is on Friday."));
    const hits = memory.search("ideas for my coffee shop menu");
    expect(hits.map(hit => hit.content)).toEqual(["My coffee shop project is called Night Owl Roasters."]);
    expect(memory.search("weather tomorrow")).toEqual([]);
  });

  it("respects the limit and returns nothing for an empty query", () => {
    const now = new Date().toISOString();
    const entries = Array.from({ length: 6 }, (_, i) => ({
      id: String(i), createdAt: now, layer: "semantic" as const,
      content: `rust compiler note ${i}`, provenance: { agentId: "user", verified: false, sourceRefs: [] }
    }));
    expect(rankMemories(entries, "rust compiler", { limit: 2 })).toHaveLength(2);
    expect(rankMemories(entries, "   ")).toEqual([]);
  });
});

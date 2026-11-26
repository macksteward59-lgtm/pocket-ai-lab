import { describe, expect, it } from "vitest";
import { MemoryManager, type MemoryEntry, type MemoryStore } from "./MemoryManager";

function entry(content: string, verified = false): Omit<MemoryEntry, "id" | "createdAt"> {
  return {
    layer: "semantic",
    content,
    provenance: { agentId: "user", verified, sourceRefs: ["source-1"] }
  };
}

describe("MemoryManager", () => {
  it("lists defensive copies and always starts new entries unverified", async () => {
    const memory = new MemoryManager();
    const id = await memory.write(entry("Keep this", true));
    const first = memory.list()[0];
    expect(first.id).toBe(id);
    expect(first.provenance.verified).toBe(false);
    first.content = "mutated outside";
    first.provenance.sourceRefs.push("forged-ref");
    expect(memory.list()[0].content).toBe("Keep this");
    expect(memory.list()[0].provenance.sourceRefs).toEqual(["source-1"]);
  });

  it("deletes an entry and reports missing ids without changing the store", async () => {
    const memory = new MemoryManager();
    const id = await memory.write(entry("Delete me"));
    expect(await memory.delete("missing")).toBe(false);
    expect(await memory.delete(id)).toBe(true);
    expect(memory.list()).toEqual([]);
  });

  it("persists deletion and restores the entry when the backend save fails", async () => {
    let fail = false;
    let saved: MemoryEntry[] = [];
    const backend: MemoryStore = {
      load: () => [],
      save: entries => {
        if (fail) throw new Error("disk unavailable");
        saved = entries;
      }
    };
    const memory = new MemoryManager(backend);
    const id = await memory.write(entry("Retain on failure"));
    fail = true;
    await expect(memory.delete(id)).rejects.toThrow("disk unavailable");
    expect(memory.list().map(value => value.content)).toEqual(["Retain on failure"]);
    expect(saved.map(value => value.content)).toEqual(["Retain on failure"]);
  });

  it("serializes concurrent writes so a failed save cannot remove another writer's entry", async () => {
    let saves = 0;
    let persisted: MemoryEntry[] = [];
    const backend: MemoryStore = {
      load: () => [],
      save: async entries => {
        saves += 1;
        if (saves === 1) {
          await new Promise(resolve => setTimeout(resolve, 5));
          throw new Error("first save failed");
        }
        persisted = entries;
      }
    };
    const memory = new MemoryManager(backend);
    const first = memory.write(entry("first")).catch(error => error);
    const second = memory.write(entry("second"));
    const [firstResult, secondId] = await Promise.all([first, second]);
    expect(firstResult).toBeInstanceOf(Error);
    expect(secondId).toMatch(/^mem-/);
    expect(memory.list().map(value => value.content)).toEqual(["second"]);
    expect(persisted.map(value => value.content)).toEqual(["second"]);
  });

  it("updates content and sources while preserving identity and resetting verification", async () => {
    let persisted: MemoryEntry[] = [];
    const backend: MemoryStore = {
      load: () => [],
      save: entries => { persisted = entries; }
    };
    const memory = new MemoryManager(backend);
    const id = await memory.write(entry("Original note"));
    await memory.markVerified(id, true);
    const before = memory.list()[0];

    expect(await memory.update(id, { content: " Revised note ", sourceRefs: ["new-source"] })).toBe(true);
    const after = memory.list()[0];
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.layer).toBe(before.layer);
    expect(after.provenance.agentId).toBe("user");
    expect(after.content).toBe("Revised note");
    expect(after.provenance.sourceRefs).toEqual(["new-source"]);
    expect(after.provenance.verified).toBe(false);
    expect(persisted[0]).toEqual(after);
  });

  it("preserves sources when omitted and rejects missing or blank updates", async () => {
    const memory = new MemoryManager();
    const id = await memory.write(entry("Original note"));
    expect(await memory.update("missing", { content: "replacement" })).toBe(false);
    await expect(memory.update(id, { content: "   " })).rejects.toThrow("Memory content is required.");
    expect(await memory.update(id, { content: "replacement" })).toBe(true);
    expect(memory.list()[0].provenance.sourceRefs).toEqual(["source-1"]);
  });

  it("rolls back an edit when persistence fails", async () => {
    let fail = false;
    const backend: MemoryStore = {
      load: () => [],
      save: () => { if (fail) throw new Error("disk unavailable"); }
    };
    const memory = new MemoryManager(backend);
    const id = await memory.write(entry("Keep original"));
    fail = true;
    await expect(memory.update(id, { content: "Must not replace" })).rejects.toThrow("disk unavailable");
    expect(memory.list()[0].content).toBe("Keep original");
  });

  it("keeps verification changes explicit and rolls them back on persistence failure", async () => {
    let fail = false;
    const backend: MemoryStore = {
      load: () => [],
      save: () => { if (fail) throw new Error("disk unavailable"); }
    };
    const memory = new MemoryManager(backend);
    const id = await memory.write(entry("Needs review"));
    expect(memory.list()[0].provenance.verified).toBe(false);
    fail = true;
    await expect(memory.markVerified(id, true)).rejects.toThrow("disk unavailable");
    expect(memory.list()[0].provenance.verified).toBe(false);
  });
});

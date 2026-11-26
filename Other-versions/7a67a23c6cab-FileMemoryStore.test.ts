import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileMemoryStore, MemoryStoreError } from "./FileMemoryStore";
import { MemoryManager } from "./MemoryManager";

async function directory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pocket-memory-"));
}

describe("file memory store", () => {
  it("reloads unverified entries unchanged", async () => {
    const dir = await directory();
    try {
      const store = await FileMemoryStore.open(dir);
      const memory = new MemoryManager(store);
      await memory.init();
      const id = await memory.write({
        layer: "episodic",
        content: "Agents proposed a boundary.",
        provenance: { agentId: "director", taskId: "task-1", verified: false, sourceRefs: ["ref-1"] }
      });
      const reloaded = new MemoryManager(await FileMemoryStore.open(dir));
      await reloaded.init();
      const found = reloaded.getByTask("task-1")[0];
      expect(found?.id).toBe(id);
      expect(found?.provenance.verified).toBe(false);
      expect(found?.content).toBe("Agents proposed a boundary.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists an explicit verification change and does not invent one", async () => {
    const dir = await directory();
    try {
      const memory = new MemoryManager(await FileMemoryStore.open(dir));
      await memory.init();
      const id = await memory.write({
        layer: "episodic",
        content: "Unchecked note.",
        provenance: { agentId: "validator", verified: false, sourceRefs: [] }
      });
      const stored = (await (await FileMemoryStore.open(dir)).load()).find(entry => entry.id === id);
      expect(stored?.provenance.verified).toBe(false);
      await memory.markVerified(id, true);
      const after = await (await FileMemoryStore.open(dir)).load();
      expect(after.find(entry => entry.id === id)?.provenance.verified).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a corrupt file and leaves it in place", async () => {
    const dir = await directory();
    try {
      const store = await FileMemoryStore.open(dir);
      const memory = new MemoryManager(store);
      await memory.init();
      await memory.write({
        layer: "semantic",
        content: "Keep this.",
        provenance: { agentId: "archivist", verified: false, sourceRefs: [] }
      });
      const file = join(dir, "memory.json");
      const original = await readFile(file, "utf8");
      await writeFile(file, original.replace("Keep this.", "Tampered."));
      await expect(store.load()).rejects.toMatchObject({ name: "MemoryStoreError", code: "integrity" });
      expect(await readFile(file, "utf8")).toContain("Tampered.");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("recovers a complete temporary file when the primary file is missing", async () => {
    const dir = await directory();
    try {
      const store = await FileMemoryStore.open(dir);
      const memory = new MemoryManager(store);
      await memory.init();
      await memory.write({
        layer: "working",
        content: "Recover me.",
        provenance: { agentId: "reasoner", verified: false, sourceRefs: [] }
      });
      const file = join(dir, "memory.json");
      const bytes = await readFile(file);
      await rm(file);
      await writeFile(file + ".tmp", bytes);
      const loaded = await (await FileMemoryStore.open(dir)).load();
      expect(loaded.map(entry => entry.content)).toEqual(["Recover me."]);
      expect(loaded[0]?.provenance.verified).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops an incomplete temporary file instead of loading it", async () => {
    const dir = await directory();
    try {
      await writeFile(join(dir, "memory.json.tmp"), "{not json");
      const loaded = await (await FileMemoryStore.open(dir)).load();
      expect(loaded).toEqual([]);
      await expect(readFile(join(dir, "memory.json.rejected"), "utf8")).resolves.toContain("{not json");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rolls back a write when the store rejects the save", async () => {
    const memory = new MemoryManager({
      load: () => [],
      save: () => {
        throw new Error("disk full");
      }
    });
    await expect(memory.write({
      layer: "episodic",
      content: "should not stick",
      provenance: { agentId: "director", taskId: "t", verified: false, sourceRefs: [] }
    })).rejects.toThrow(/disk full/);
    expect(memory.getByTask("t")).toEqual([]);
  });

  it("rejects use after close", async () => {
    const dir = await directory();
    try {
      const store = await FileMemoryStore.open(dir);
      await store.close();
      await expect(store.load()).rejects.toBeInstanceOf(MemoryStoreError);
      await expect(store.save([])).rejects.toMatchObject({ code: "closed" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

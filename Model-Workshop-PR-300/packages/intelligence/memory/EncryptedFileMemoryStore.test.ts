import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EncryptedFileMemoryStore, EncryptedMemoryStoreError } from "./EncryptedFileMemoryStore";
import { FileMemoryStore } from "./FileMemoryStore";
import type { MemoryEntry } from "./MemoryManager";
import type { MemoryKeyProvider } from "./MemoryKeyProvider";
import { migratePlaintextMemory } from "./migratePlaintextMemory";

class TestKeyProvider implements MemoryKeyProvider {
  constructor(private readonly key: Uint8Array | null = new Uint8Array(32).fill(7)) {}
  async getOrCreateKey(): Promise<Uint8Array | null> { return this.key; }
}

async function directory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pocket-encrypted-memory-"));
}

const sample: MemoryEntry = {
  id: "mem-test-1",
  layer: "episodic",
  content: "A private memory phrase that must not appear on disk.",
  createdAt: "2026-11-12T00:00:00.000Z",
  provenance: { agentId: "user", taskId: "task-1", verified: false, sourceRefs: ["source-1"] }
};

describe("encrypted file memory store", () => {
  it("encrypts memory contents at rest and reloads them with the same key", async () => {
    const dir = await directory();
    try {
      const provider = new TestKeyProvider();
      const store = await EncryptedFileMemoryStore.open(dir, provider);
      await store.save([sample]);
      const disk = await readFile(join(dir, "memory.enc"), "utf8");
      expect(disk).not.toContain(sample.content);
      expect(disk).not.toContain("source-1");
      const reopened = await EncryptedFileMemoryStore.open(dir, provider);
      expect(await reopened.load()).toEqual([sample]);
      await store.close();
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when the platform key is unavailable", async () => {
    const dir = await directory();
    try {
      const store = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider(null));
      await expect(store.save([sample])).rejects.toMatchObject({
        name: "EncryptedMemoryStoreError", code: "key-unavailable"
      });
      await expect(store.load()).resolves.toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects modified ciphertext without returning data", async () => {
    const dir = await directory();
    try {
      const store = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider());
      await store.save([sample]);
      const file = join(dir, "memory.enc");
      const envelope = JSON.parse(await readFile(file, "utf8")) as { ciphertext: string };
      envelope.ciphertext = (envelope.ciphertext[0] === "A" ? "B" : "A") + envelope.ciphertext.slice(1);
      await writeFile(file, JSON.stringify(envelope));
      await expect(store.load()).rejects.toMatchObject({
        name: "EncryptedMemoryStoreError", code: "integrity"
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a wrong key", async () => {
    const dir = await directory();
    try {
      const writer = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider(new Uint8Array(32).fill(3)));
      await writer.save([sample]);
      const reader = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider(new Uint8Array(32).fill(4)));
      await expect(reader.load()).rejects.toMatchObject({ code: "integrity" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a key provider that returns the wrong key length", async () => {
    const dir = await directory();
    try {
      const store = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider(new Uint8Array(16)));
      await expect(store.save([sample])).rejects.toBeInstanceOf(EncryptedMemoryStoreError);
      await expect(store.save([sample])).rejects.toMatchObject({ code: "key-unavailable" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("requires an explicit migration and preserves the plaintext source", async () => {
    const dir = await directory();
    try {
      const sourceDir = join(dir, "legacy");
      const targetDir = join(dir, "encrypted");
      const legacy = await FileMemoryStore.open(sourceDir);
      await legacy.save([sample]);
      const encrypted = await EncryptedFileMemoryStore.open(targetDir, new TestKeyProvider());
      const result = await migratePlaintextMemory(legacy, encrypted);
      expect(result).toEqual({ entriesCopied: 1, sourcePreserved: true });
      expect(await legacy.load()).toEqual([sample]);
      expect(await encrypted.load()).toEqual([sample]);
      const encryptedDisk = await readFile(join(targetDir, "memory.enc"), "utf8");
      expect(encryptedDisk).not.toContain(sample.content);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an encrypted target containing entries", async () => {
    const source = { load: async () => [sample], save: async () => undefined };
    const target = { load: async () => [sample], save: async () => undefined };
    await expect(migratePlaintextMemory(source, target)).rejects.toThrow(/not empty/);
  });

  it("waits for active saves before zeroing its cached key on close", async () => {
    const dir = await directory();
    const key = new Uint8Array(32).fill(9);
    let resolveKey!: (value: Uint8Array | null) => void;
    let signalRequested!: () => void;
    const requested = new Promise<void>(resolve => { signalRequested = resolve; });
    const provider: MemoryKeyProvider = {
      getOrCreateKey() {
        signalRequested();
        return new Promise(resolve => { resolveKey = resolve; });
      }
    };
    try {
      const store = await EncryptedFileMemoryStore.open(dir, provider);
      const saving = store.save([sample]);
      await requested;
      const closing = store.close();
      resolveKey(key);
      await expect(saving).resolves.toBeUndefined();
      await expect(closing).resolves.toBeUndefined();
      const reopened = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider(key));
      await expect(reopened.load()).resolves.toEqual([sample]);
      await expect(store.load()).rejects.toMatchObject({ code: "closed" });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects malformed envelope versions, algorithms, IVs, tags, and base64", async () => {
    const dir = await directory();
    try {
      const store = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider());
      await store.save([sample]);
      const file = join(dir, "memory.enc");
      const original = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
      const invalid: Array<(value: Record<string, unknown>) => void> = [
        value => { value.version = 2; },
        value => { value.algorithm = "A128GCM"; },
        value => { value.iv = Buffer.alloc(11).toString("base64"); },
        value => { value.tag = Buffer.alloc(15).toString("base64"); },
        value => { value.iv = Buffer.alloc(12, 1).toString("base64"); },
        value => { value.tag = Buffer.alloc(16, 1).toString("base64"); },
        value => { value.iv = String(value.iv) + "!"; },
        value => { value.ciphertext = String(value.ciphertext) + "!"; }
      ];
      for (const mutate of invalid) {
        const envelope = { ...original };
        mutate(envelope);
        await writeFile(file, JSON.stringify(envelope));
        await expect(store.load()).rejects.toMatchObject({ code: "integrity" });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("cleans temporary files when atomic replacement fails", async () => {
    const dir = await directory();
    try {
      await mkdir(join(dir, "memory.enc"));
      const store = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider());
      await expect(store.save([sample])).rejects.toBeDefined();
      const names = await readdir(dir);
      expect(names).toEqual(["memory.enc"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not remove another process's lock when exclusive lock acquisition fails", async () => {
    const dir = await directory();
    const lockPath = join(dir, "memory.enc.lock");
    try {
      await writeFile(lockPath, "other-process");
      const store = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider());
      await expect(store.save([sample])).rejects.toMatchObject({ code: "invalid" });
      await expect(readFile(lockPath, "utf8")).resolves.toBe("other-process");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves migration entries whose optional taskId is absent", async () => {
    const dir = await directory();
    const entryWithoutTask: MemoryEntry = {
      ...sample,
      id: "mem-without-task",
      provenance: { agentId: "user", verified: false, sourceRefs: ["source-1"] }
    };
    try {
      const source = { load: async () => [entryWithoutTask], save: async () => undefined };
      const target = await EncryptedFileMemoryStore.open(join(dir, "encrypted"), new TestKeyProvider());
      const result = await migratePlaintextMemory(source, target);
      expect(result).toEqual({ entriesCopied: 1, sourcePreserved: true });
      await expect(target.load()).resolves.toEqual([entryWithoutTask]);
      await target.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("allows only one concurrent migration to populate a shared encrypted target", async () => {
    const dir = await directory();
    const second: MemoryEntry = { ...sample, id: "mem-test-2", content: "second source" };
    try {
      const targetA = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider());
      const targetB = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider());
      const sourceA = { load: async () => [sample], save: async () => undefined };
      const sourceB = { load: async () => [second], save: async () => undefined };
      const results = await Promise.allSettled([
        migratePlaintextMemory(sourceA, targetA),
        migratePlaintextMemory(sourceB, targetB)
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const loaded = await targetA.load();
      expect(loaded).toHaveLength(1);
      expect([sample.id, second.id]).toContain(loaded[0].id);
      await targetA.close();
      await targetB.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not silently reinterpret an existing plaintext memory.json", async () => {
    const dir = await directory();
    try {
      const legacy = await FileMemoryStore.open(dir);
      await legacy.save([sample]);
      const encrypted = await EncryptedFileMemoryStore.open(dir, new TestKeyProvider());
      await expect(encrypted.load()).resolves.toEqual([]);
      expect(await readFile(join(dir, "memory.json"), "utf8")).toContain(sample.content);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

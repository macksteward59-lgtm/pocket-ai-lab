import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

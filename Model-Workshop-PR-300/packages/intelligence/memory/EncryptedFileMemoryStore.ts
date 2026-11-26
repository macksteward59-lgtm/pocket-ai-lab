/**
 * AES-256-GCM encrypted memory file store.
 * No environment-variable, adjacent-file, or hard-coded-key fallback exists.
 * Existing plaintext FileMemoryStore files are never migrated automatically.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MemoryEntry, MemoryStore } from "./MemoryManager";
import type { MemoryKeyProvider } from "./MemoryKeyProvider";

const VERSION = 1;
const ALGORITHM = "A256GCM";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from("pocket-ai-lab:encrypted-memory:v1", "utf8");

/** Serializes writers across instances in this process; lock files cover other processes. */
const WRITE_QUEUES = new Map<string, Promise<void>>();

interface EncryptedEnvelope {
  version: number;
  algorithm: typeof ALGORITHM;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class EncryptedMemoryStoreError extends Error {
  readonly code: "key-unavailable" | "integrity" | "invalid" | "closed";
  constructor(code: "key-unavailable" | "integrity" | "invalid" | "closed", message: string) {
    super(message);
    this.name = "EncryptedMemoryStoreError";
    this.code = code;
  }
}

export class EncryptedFileMemoryStore implements MemoryStore {
  private closing = false;
  private closed = false;
  private key?: Buffer;
  private keyPromise?: Promise<Buffer>;
  private activeOperations = 0;
  private idleResolvers: Array<() => void> = [];
  private closePromise?: Promise<void>;

  private constructor(private readonly filePath: string, private readonly keyProvider: MemoryKeyProvider) {}

  static async open(directory: string, keyProvider: MemoryKeyProvider): Promise<EncryptedFileMemoryStore> {
    if (!directory || typeof directory !== "string") {
      throw new EncryptedMemoryStoreError("invalid", "A memory directory is required.");
    }
    if (!keyProvider || typeof keyProvider.getOrCreateKey !== "function") {
      throw new EncryptedMemoryStoreError("invalid", "A platform memory key provider is required.");
    }
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await chmod(directory, 0o700);
    return new EncryptedFileMemoryStore(join(directory, "memory.enc"), keyProvider);
  }

  get path(): string { return this.filePath; }

  async load(): Promise<MemoryEntry[]> {
    return this.withOperation(() => this.loadUnlocked());
  }

  async save(entries: MemoryEntry[]): Promise<void> {
    return this.withOperation(() => this.withWriteLock(() => this.saveUnlocked(entries)));
  }

  /**
   * Atomic empty-check + save + read-back for explicit plaintext migration.
   * The cross-process lock spans the complete operation, preventing two
   * migrations from both observing an empty vault and overwriting each other.
   */
  async migrateIfEmpty(entries: MemoryEntry[]): Promise<MemoryEntry[]> {
    return this.withOperation(() => this.withWriteLock(async () => {
      const existing = await this.loadUnlocked();
      if (existing.length > 0) {
        throw new Error("Encrypted memory target is not empty; refusing to overwrite it.");
      }
      await this.saveUnlocked(entries);
      return this.loadUnlocked();
    }));
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    if (this.closed) return;
    this.closing = true;
    this.closePromise = (async () => {
      if (this.activeOperations > 0) {
        await new Promise<void>(resolve => this.idleResolvers.push(resolve));
      }
      // No active operation can still be using this buffer at this point.
      this.key?.fill(0);
      this.key = undefined;
      this.keyPromise = undefined;
      this.closed = true;
    })();
    return this.closePromise;
  }

  private async loadUnlocked(): Promise<MemoryEntry[]> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.filePath);
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
    const envelope = parseEnvelope(bytes);
    const key = await this.getKey();
    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, decodeBase64(envelope.iv, IV_BYTES));
      decipher.setAAD(AAD);
      decipher.setAuthTag(decodeBase64(envelope.tag, TAG_BYTES));
      plaintext = Buffer.concat([
        decipher.update(decodeBase64(envelope.ciphertext)),
        decipher.final()
      ]);
    } catch {
      throw new EncryptedMemoryStoreError("integrity", "Encrypted memory authentication failed. The file was not modified.");
    }
    try {
      const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
      if (!Array.isArray(parsed)) throw new Error("Memory payload must be an array.");
      return parsed.map(checkEntry);
    } catch (error) {
      if (error instanceof EncryptedMemoryStoreError) throw error;
      throw new EncryptedMemoryStoreError("integrity", "Encrypted memory payload is invalid.");
    } finally {
      plaintext.fill(0);
    }
  }

  private async saveUnlocked(entries: MemoryEntry[]): Promise<void> {
    if (!Array.isArray(entries)) throw new EncryptedMemoryStoreError("invalid", "Memory entries must be an array.");
    const checked = entries.map(checkEntry);
    const plaintext = Buffer.from(JSON.stringify(checked), "utf8");
    let encrypted: Buffer | undefined;
    let envelopeBytes: Buffer | undefined;
    let temporaryPath: string | undefined;
    let renamed = false;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      const key = await this.getKey();
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      const envelope: EncryptedEnvelope = {
        version: VERSION,
        algorithm: ALGORITHM,
        iv: iv.toString("base64"),
        tag: tag.toString("base64"),
        ciphertext: encrypted.toString("base64")
      };
      envelopeBytes = Buffer.from(JSON.stringify(envelope), "utf8");
      temporaryPath = this.filePath + "." + randomUUID() + ".tmp";
      handle = await open(temporaryPath, "wx", 0o600);
      await handle.writeFile(envelopeBytes);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporaryPath, this.filePath);
      renamed = true;
      // The temp file was created mode 0600; rename preserves that mode.
      // Flush the containing directory so the replacement is durable on POSIX.
      if (process.platform !== "win32") {
        const directoryHandle = await open(dirname(this.filePath), "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      if (temporaryPath && !renamed) await unlink(temporaryPath).catch(() => undefined);
      plaintext.fill(0);
      encrypted?.fill(0);
      envelopeBytes?.fill(0);
    }
  }

  private async getKey(): Promise<Buffer> {
    if (this.key) return this.key;
    if (this.keyPromise) return this.keyPromise;
    const pending = (async () => {
      let supplied: Uint8Array | null;
      try {
        supplied = await this.keyProvider.getOrCreateKey();
      } catch {
        throw new EncryptedMemoryStoreError("key-unavailable", "The platform memory encryption key is unavailable.");
      }
      if (!supplied) {
        throw new EncryptedMemoryStoreError("key-unavailable", "The platform memory encryption key is unavailable.");
      }
      if (!(supplied instanceof Uint8Array) || supplied.byteLength !== KEY_BYTES) {
        throw new EncryptedMemoryStoreError("key-unavailable", "The platform key provider must return exactly 32 key bytes.");
      }
      // Copy provider-owned material. close() only zeroes this private copy.
      this.key = Buffer.from(supplied);
      return this.key;
    })();
    this.keyPromise = pending;
    try {
      return await pending;
    } finally {
      if (this.keyPromise === pending) this.keyPromise = undefined;
    }
  }

  private async withOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    this.activeOperations += 1;
    try {
      return await operation();
    } finally {
      this.activeOperations -= 1;
      if (this.activeOperations === 0) {
        const resolvers = this.idleResolvers.splice(0);
        for (const resolve of resolvers) resolve();
      }
    }
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = WRITE_QUEUES.get(this.filePath) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    WRITE_QUEUES.set(this.filePath, current);
    await previous;
    const lockPath = this.filePath + ".lock";
    let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      try {
        lockHandle = await open(lockPath, "wx", 0o600);
      } catch (error) {
        if (isAlreadyExists(error)) {
          throw new EncryptedMemoryStoreError("invalid", "Another encrypted memory writer or migration is active; retry after it finishes.");
        }
        throw error;
      }
      await lockHandle.writeFile(String(process.pid));
      await lockHandle.sync();
      return await operation();
    } finally {
      if (lockHandle) {
        await lockHandle.close().catch(() => undefined);
        await unlink(lockPath).catch(() => undefined);
      }
      release();
      if (WRITE_QUEUES.get(this.filePath) === current) WRITE_QUEUES.delete(this.filePath);
    }
  }

  private assertOpen(): void {
    if (this.closing || this.closed) throw new EncryptedMemoryStoreError("closed", "Encrypted memory store is closed or closing.");
  }
}

function parseEnvelope(bytes: Buffer): EncryptedEnvelope {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value) ||
      Object.keys(value).sort().join(",") !== "algorithm,ciphertext,iv,tag,version" ||
      value.version !== VERSION || value.algorithm !== ALGORITHM ||
      typeof value.iv !== "string" || typeof value.tag !== "string" || typeof value.ciphertext !== "string") {
      throw new Error("Unsupported encrypted memory envelope.");
    }
    decodeBase64(value.iv, IV_BYTES);
    decodeBase64(value.tag, TAG_BYTES);
    decodeBase64(value.ciphertext);
    return value as unknown as EncryptedEnvelope;
  } catch {
    throw new EncryptedMemoryStoreError("integrity", "Encrypted memory envelope is invalid.");
  }
}

function decodeBase64(value: string, exactLength?: number): Buffer {
  const decoded = Buffer.from(value, "base64");
  if (decoded.toString("base64") !== value || (exactLength !== undefined && decoded.length !== exactLength)) {
    throw new Error("Invalid base64 field.");
  }
  return decoded;
}

function checkEntry(value: unknown): MemoryEntry {
  if (!isRecord(value)) throw new EncryptedMemoryStoreError("invalid", "Memory entry must be an object.");
  const provenance = value.provenance;
  if (!isRecord(provenance) || typeof provenance.agentId !== "string" || typeof provenance.verified !== "boolean") {
    throw new EncryptedMemoryStoreError("invalid", "Memory provenance is invalid.");
  }
  if (typeof value.id !== "string" || typeof value.content !== "string" || typeof value.createdAt !== "string") {
    throw new EncryptedMemoryStoreError("invalid", "Memory entry is missing required fields.");
  }
  if (value.layer !== "working" && value.layer !== "episodic" && value.layer !== "semantic" && value.layer !== "procedural") {
    throw new EncryptedMemoryStoreError("invalid", "Memory layer is not recognized.");
  }
  if (provenance.taskId !== undefined && typeof provenance.taskId !== "string") {
    throw new EncryptedMemoryStoreError("invalid", "Memory taskId must be a string.");
  }
  if (!Array.isArray(provenance.sourceRefs) || provenance.sourceRefs.some(ref => typeof ref !== "string")) {
    throw new EncryptedMemoryStoreError("invalid", "Memory sourceRefs must be a string array.");
  }
  return {
    id: value.id,
    layer: value.layer,
    content: value.content,
    createdAt: value.createdAt,
    provenance: {
      agentId: provenance.agentId,
      ...(typeof provenance.taskId === "string" ? { taskId: provenance.taskId } : {}),
      verified: provenance.verified,
      sourceRefs: [...provenance.sourceRefs]
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "EEXIST";
}

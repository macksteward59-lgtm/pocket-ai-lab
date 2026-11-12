/**
 * AES-256-GCM encrypted memory file store.
 * No environment-variable, adjacent-file, or hard-coded-key fallback exists.
 * Existing plaintext FileMemoryStore files are never migrated automatically.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryEntry, MemoryStore } from "./MemoryManager";
import type { MemoryKeyProvider } from "./MemoryKeyProvider";

const VERSION = 1;
const ALGORITHM = "A256GCM";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from("pocket-ai-lab:encrypted-memory:v1", "utf8");

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
  private closed = false;
  private key?: Buffer;

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
    this.assertOpen();
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

  async save(entries: MemoryEntry[]): Promise<void> {
    this.assertOpen();
    if (!Array.isArray(entries)) throw new EncryptedMemoryStoreError("invalid", "Memory entries must be an array.");
    const checked = entries.map(checkEntry);
    const plaintext = Buffer.from(JSON.stringify(checked), "utf8");
    const key = await this.getKey();
    const iv = randomBytes(IV_BYTES);
    let encrypted: Buffer;
    let tag: Buffer;
    try {
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      tag = cipher.getAuthTag();
    } finally {
      plaintext.fill(0);
    }
    const envelope: EncryptedEnvelope = {
      version: VERSION,
      algorithm: ALGORITHM,
      iv: iv.toString("base64"),
      tag: tag!.toString("base64"),
      ciphertext: encrypted!.toString("base64")
    };
    const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
    const temporaryPath = this.filePath + "." + randomUUID() + ".tmp";
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporaryPath, this.filePath);
      if (process.platform !== "win32") await chmod(this.filePath, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.key?.fill(0);
    this.key = undefined;
  }

  private async getKey(): Promise<Buffer> {
    if (this.key) return this.key;
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
    this.key = Buffer.from(supplied);
    return this.key;
  }

  private assertOpen(): void {
    if (this.closed) throw new EncryptedMemoryStoreError("closed", "Encrypted memory store is closed.");
  }
}

function parseEnvelope(bytes: Buffer): EncryptedEnvelope {
  try {
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(value) || value.version !== VERSION || value.algorithm !== ALGORITHM ||
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
      taskId: typeof provenance.taskId === "string" ? provenance.taskId : undefined,
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

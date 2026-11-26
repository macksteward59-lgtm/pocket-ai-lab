/**
 * Durable memory file.
 * Writes are checksummed and replaced atomically. A corrupt file is refused.
 * Loading never changes provenance.verified.
 */

import { createHash } from "node:crypto";
import { open, readFile, rename, unlink, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import type { MemoryEntry, MemoryStore } from "./MemoryManager";

const VERSION = 1;

export class MemoryStoreError extends Error {
  readonly code: "integrity" | "closed" | "invalid";

  constructor(code: "integrity" | "closed" | "invalid", message: string) {
    super(message);
    this.name = "MemoryStoreError";
    this.code = code;
  }
}

interface Envelope {
  version: number;
  checksum: string;
  entries: MemoryEntry[];
}

export class FileMemoryStore implements MemoryStore {
  private closed = false;

  private constructor(private readonly filePath: string) {}

  static async open(directory: string): Promise<FileMemoryStore> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      await chmod(directory, 0o700);
      await chmod(join(directory, "memory.json"), 0o600).catch(error => {
        if (!isNotFound(error)) throw error;
      });
    }
    return new FileMemoryStore(join(directory, "memory.json"));
  }

  get path(): string {
    return this.filePath;
  }

  async load(): Promise<MemoryEntry[]> {
    this.assertOpen();
    const primary = await readEnvelope(this.filePath);
    if (primary.status === "valid") {
      await unlinkQuiet(this.tmpPath());
      return primary.entries;
    }
    if (primary.status === "missing") {
      const recovered = await readEnvelope(this.tmpPath());
      if (recovered.status === "valid") {
        await rename(this.tmpPath(), this.filePath);
        return recovered.entries;
      }
      if (recovered.status === "invalid") {
        await rename(this.tmpPath(), this.filePath + ".rejected").catch(() => undefined);
      }
      return [];
    }
    throw new MemoryStoreError(
      "integrity",
      `Memory file ${this.filePath} failed its checksum or schema and was left in place.`
    );
  }

  async save(entries: MemoryEntry[]): Promise<void> {
    this.assertOpen();
    const payload = Buffer.from(serialize(entries), "utf8");
    const handle = await open(this.tmpPath(), "w", 0o600);
    try {
      await handle.writeFile(payload);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(this.tmpPath(), this.filePath);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private tmpPath(): string {
    return this.filePath + ".tmp";
  }

  private assertOpen(): void {
    if (this.closed) throw new MemoryStoreError("closed", "Memory store is closed.");
  }
}

function serialize(entries: MemoryEntry[]): string {
  const checked = entries.map(checkEntry);
  const body = canonicalize(checked);
  const envelope = {
    version: VERSION,
    checksum: sha256(body),
    entries: checked
  };
  return JSON.stringify(envelope);
}

async function readEnvelope(filePath: string): Promise<
  { status: "missing" } | { status: "invalid" } | { status: "valid"; entries: MemoryEntry[] }
> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) return { status: "missing" };
    return { status: "invalid" };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Envelope>;
    if (parsed.version !== VERSION || !Array.isArray(parsed.entries) || typeof parsed.checksum !== "string") {
      return { status: "invalid" };
    }
    const entries = parsed.entries.map(checkEntry);
    if (parsed.checksum !== sha256(canonicalize(entries))) return { status: "invalid" };
    return { status: "valid", entries };
  } catch {
    return { status: "invalid" };
  }
}

function checkEntry(value: unknown): MemoryEntry {
  if (!isRecord(value)) throw new MemoryStoreError("invalid", "Memory entry must be an object.");
  const provenance = value.provenance;
  if (!isRecord(provenance) || typeof provenance.agentId !== "string" || typeof provenance.verified !== "boolean") {
    throw new MemoryStoreError("invalid", "Memory provenance.verified must be an explicit boolean.");
  }
  if (typeof value.id !== "string" || typeof value.content !== "string" || typeof value.createdAt !== "string") {
    throw new MemoryStoreError("invalid", "Memory entry is missing id, content, or createdAt.");
  }
  if (value.layer !== "working" && value.layer !== "episodic" && value.layer !== "semantic" && value.layer !== "procedural") {
    throw new MemoryStoreError("invalid", "Memory layer is not recognized.");
  }
  if (provenance.taskId !== undefined && typeof provenance.taskId !== "string") {
    throw new MemoryStoreError("invalid", "Memory taskId must be a string when present.");
  }
  if (!Array.isArray(provenance.sourceRefs) || provenance.sourceRefs.some(ref => typeof ref !== "string")) {
    throw new MemoryStoreError("invalid", "Memory sourceRefs must be a string array.");
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

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

async function unlinkQuiet(filePath: string): Promise<void> {
  await unlink(filePath).catch(error => {
    if (!isNotFound(error)) throw error;
  });
}

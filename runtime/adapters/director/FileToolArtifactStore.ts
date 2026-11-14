import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, mkdir, open, readdir, realpath, rename, rm, lstat } from "node:fs/promises";
import path from "node:path";
import type { ToolArtifact, ToolArtifactStore } from "../../../packages/intelligence/tooling/ToolDirector";

const TOOL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_TOOL_DIRECTORIES = 10_000;

/**
 * Durable, local-filesystem artifact history for the Director Tool Workshop.
 *
 * This adapter stores source as inert JSON. It never imports, evaluates, or
 * executes generated code. Use a private app-data directory, not a repository
 * checkout or a user-selected shared folder. Files are owner-only (0600) and
 * directories are owner-only (0700) where the platform supports POSIX modes.
 *
 * This is a single-process local store, not a multi-host database. It does not
 * encrypt source at rest; hosts handling sensitive artifacts must provide
 * encrypted storage or an OS-protected application-data volume.
 */
export class FileToolArtifactStore implements ToolArtifactStore {
  private root: string;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(rootDirectory: string) {
    if (typeof rootDirectory !== "string" || !rootDirectory.trim()) {
      throw new Error("A private artifact directory is required");
    }
    this.root = path.resolve(rootDirectory);
  }

  async getLatest(toolId: string): Promise<ToolArtifact | undefined> {
    validateToolId(toolId);
    const versions = await this.readToolArtifacts(toolId);
    return versions.length ? cloneArtifact(versions[versions.length - 1]) : undefined;
  }

  async put(artifact: ToolArtifact): Promise<void> {
    validateArtifact(artifact);
    await this.withLock(artifact.toolId, async () => {
      const directory = await this.ensureToolDirectory(artifact.toolId);
      const target = path.join(directory, `${artifact.version}.json`);
      const temporary = path.join(directory, `.${artifact.version}.${randomUUID()}.tmp`);
      const serialized = JSON.stringify(cloneArtifact(artifact));
      if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
        throw new Error("Tool artifact exceeds the 2 MB storage limit");
      }

      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporary, target);
        await syncDirectory(directory);
      } catch (error) {
        if (handle) await handle.close().catch(() => undefined);
        await rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  async list(): Promise<ToolArtifact[]> {
    await this.ensureRoot();
    const entries = await readdir(this.root, { withFileTypes: true });
    if (entries.length > MAX_TOOL_DIRECTORIES) throw new Error("Artifact store contains too many tool directories");
    const output: ToolArtifact[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !TOOL_ID.test(entry.name)) continue;
      const artifacts = await this.readToolArtifacts(entry.name);
      output.push(...artifacts);
    }
    return output.sort((a, b) => a.toolId.localeCompare(b.toolId) || a.version - b.version)
      .map(cloneArtifact);
  }

  private async readToolArtifacts(toolId: string): Promise<ToolArtifact[]> {
    const directory = await this.existingToolDirectory(toolId);
    if (!directory) return [];
    const entries = await readdir(directory, { withFileTypes: true });
    const files = entries.filter(entry => entry.isFile() && /^([1-9][0-9]*)\.json$/.test(entry.name))
      .sort((a, b) => Number(a.name.slice(0, -5)) - Number(b.name.slice(0, -5)));
    const artifacts: ToolArtifact[] = [];
    for (const entry of files) {
      const version = Number(entry.name.slice(0, -5));
      if (!Number.isSafeInteger(version)) throw new Error("Invalid artifact version filename");
      const filename = path.join(directory, entry.name);
      const handle = await open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) throw new Error("Invalid or oversized artifact record");
        const content = await handle.readFile("utf8");
        let parsed: unknown;
        try { parsed = JSON.parse(content); } catch { throw new Error("Corrupt artifact record: " + entry.name); }
        validateArtifact(parsed);
        const artifact = parsed as ToolArtifact;
        if (artifact.toolId !== toolId || artifact.version !== version) {
          throw new Error("Artifact record identity does not match its storage path");
        }
        artifacts.push(cloneArtifact(artifact));
      } finally {
        await handle.close();
      }
    }
    return artifacts;
  }

  private async ensureRoot(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Artifact root must be a real directory, not a symbolic link");
    }
    // Canonicalize parent symlinks (for example macOS /var -> /private/var)
    // while still rejecting a symlink at the configured root itself.
    this.root = await realpath(this.root);
    await chmod(this.root, 0o700);
  }

  private async ensureToolDirectory(toolId: string): Promise<string> {
    await this.ensureRoot();
    const directory = path.join(this.root, toolId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Tool artifact path must be a real directory");
    }
    if (await realpath(directory) !== directory) throw new Error("Tool artifact path escapes the artifact root");
    await chmod(directory, 0o700);
    return directory;
  }

  private async existingToolDirectory(toolId: string): Promise<string | undefined> {
    await this.ensureRoot();
    const directory = path.join(this.root, toolId);
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Tool artifact path is not a safe directory");
      if (await realpath(directory) !== directory) throw new Error("Tool artifact path escapes the artifact root");
      return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(key, current);
    await previous;
    try { return await operation(); }
    finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}

function validateToolId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !TOOL_ID.test(value)) throw new Error("Invalid tool id");
}

function validateArtifact(value: unknown): asserts value is ToolArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid tool artifact");
  const artifact = value as Partial<ToolArtifact>;
  validateToolId(artifact.toolId);
  if (!Number.isSafeInteger(artifact.version) || (artifact.version ?? 0) < 1) throw new Error("Invalid artifact version");
  if (typeof artifact.digest !== "string" || !/^[a-f0-9]{64}$/.test(artifact.digest)) throw new Error("Invalid artifact digest");
  if (!artifact.spec || typeof artifact.spec !== "object" || artifact.spec.id !== artifact.toolId) throw new Error("Invalid artifact specification");
  if (!artifact.files || typeof artifact.files !== "object" || Array.isArray(artifact.files)) throw new Error("Invalid artifact files");
  if (!["draft", "testing", "quarantined", "ready", "active", "retired"].includes(String(artifact.status))) {
    throw new Error("Invalid artifact status");
  }
  if (typeof artifact.createdAt !== "string" || !Number.isFinite(Date.parse(artifact.createdAt))) {
    throw new Error("Invalid artifact timestamp");
  }
}

function cloneArtifact(artifact: ToolArtifact): ToolArtifact {
  return {
    ...artifact,
    spec: { ...artifact.spec, specialists: [...artifact.spec.specialists], requirements: [...artifact.spec.requirements] },
    files: { ...artifact.files },
    testSummary: artifact.testSummary ? {
      ...artifact.testSummary,
      findings: [...artifact.testSummary.findings]
    } : undefined
  };
}

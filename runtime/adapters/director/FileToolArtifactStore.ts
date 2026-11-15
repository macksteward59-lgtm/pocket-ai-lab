import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, mkdir, open, readdir, realpath, rename, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { SECURITY_SPECIALIST_IDS, type SecuritySpecialistId } from "../../../packages/intelligence/agents/AgentManager";
import type { ToolArtifact, ToolArtifactStore } from "../../../packages/intelligence/tooling/ToolDirector";

const TOOL_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION_FILE = /^([1-9][0-9]*)\.json$/;
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 1_000_000;
const MAX_TOOL_DIRECTORIES = 10_000;
const MAX_ARTIFACT_VERSIONS = 10_000;

/**
 * Durable local-filesystem artifact history for the Director Tool Workshop.
 *
 * Stores source as inert JSON. It never imports, evaluates, or executes
 * generated code. Use a private application-data directory, not a repository
 * checkout or a user-selected shared folder. Files are owner-only (0600) and
 * directories owner-only (0700) where the platform supports POSIX modes.
 *
 * This adapter is single-process local storage, not a multi-host database.
 * It does not encrypt source at rest; sensitive hosts must use an encrypted or
 * OS-protected application-data volume.
 */
export class FileToolArtifactStore implements ToolArtifactStore {
  private static readonly locks = new Map<string, Promise<void>>();
  private root: string;

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
    // Canonicalize the root before deriving the process-wide lock key.
    await this.ensureRoot();
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
    if (entries.length > MAX_TOOL_DIRECTORIES) {
      throw new Error("Artifact store contains too many tool directories");
    }
    const output: ToolArtifact[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink() && TOOL_ID.test(entry.name)) {
        throw new Error("Tool artifact path is a symbolic link");
      }
      if (!entry.isDirectory() || !TOOL_ID.test(entry.name)) continue;
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
    const candidates = entries.filter(entry => VERSION_FILE.test(entry.name));
    if (candidates.length > MAX_ARTIFACT_VERSIONS) {
      throw new Error("Tool has too many artifact versions");
    }

    const files = candidates.sort((a, b) =>
      Number(a.name.slice(0, -5)) - Number(b.name.slice(0, -5))
    );
    const artifacts: ToolArtifact[] = [];
    for (const entry of files) {
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error("Artifact record must be a regular file");
      }
      const version = Number(entry.name.slice(0, -5));
      if (!Number.isSafeInteger(version)) throw new Error("Invalid artifact version filename");
      const filename = path.join(directory, entry.name);
      const handle = await open(filename, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_ARTIFACT_BYTES) {
          throw new Error("Invalid or oversized artifact record");
        }
        if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
          throw new Error("Artifact record permissions are broader than owner-only");
        }
        const content = await handle.readFile("utf8");
        let parsed: unknown;
        try { parsed = JSON.parse(content); }
        catch { throw new Error("Corrupt artifact record: " + entry.name); }
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
    if (await realpath(directory) !== directory) {
      throw new Error("Tool artifact path escapes the artifact root");
    }
    await chmod(directory, 0o700);
    return directory;
  }

  private async existingToolDirectory(toolId: string): Promise<string | undefined> {
    await this.ensureRoot();
    const directory = path.join(this.root, toolId);
    try {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error("Tool artifact path is not a safe directory");
      }
      if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
        throw new Error("Tool artifact directory permissions are broader than owner-only");
      }
      if (await realpath(directory) !== directory) {
        throw new Error("Tool artifact path escapes the artifact root");
      }
      return directory;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async withLock<T>(toolId: string, operation: () => Promise<T>): Promise<T> {
    const key = `${this.root}\u0000${toolId}`;
    const previous = FileToolArtifactStore.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    FileToolArtifactStore.locks.set(key, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (FileToolArtifactStore.locks.get(key) === current) {
        FileToolArtifactStore.locks.delete(key);
      }
    }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, fsConstants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Some platforms do not expose fsync for directory handles. The artifact
    // file has already been synced and atomically renamed on those platforms.
    if (!["EISDIR", "EPERM", "EACCES", "EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(String(code))) {
      throw error;
    }
  } finally {
    if (handle) await handle.close();
  }
}

function validateToolId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !TOOL_ID.test(value)) throw new Error("Invalid tool id");
}

function validateArtifact(value: unknown): asserts value is ToolArtifact {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid tool artifact");
  }
  const artifact = value as Partial<ToolArtifact>;
  validateToolId(artifact.toolId);
  if (!Number.isSafeInteger(artifact.version) || (artifact.version ?? 0) < 1) {
    throw new Error("Invalid artifact version");
  }
  if (typeof artifact.digest !== "string" || !/^[a-f0-9]{64}$/.test(artifact.digest)) {
    throw new Error("Invalid artifact digest");
  }

  const spec = artifact.spec;
  if (!spec || typeof spec !== "object" || spec.id !== artifact.toolId ||
      typeof spec.name !== "string" || !spec.name.trim() ||
      typeof spec.purpose !== "string" || !spec.purpose.trim() ||
      !["create", "extend", "revise"].includes(String(spec.change)) ||
      !Array.isArray(spec.specialists) || spec.specialists.length === 0 ||
      spec.specialists.length > SECURITY_SPECIALIST_IDS.length ||
      !spec.specialists.every(item => typeof item === "string" &&
        SECURITY_SPECIALIST_IDS.includes(item as SecuritySpecialistId)) ||
      new Set(spec.specialists).size !== spec.specialists.length ||
      !Array.isArray(spec.requirements) || spec.requirements.length === 0 ||
      spec.requirements.length > 20 ||
      !spec.requirements.every(item => typeof item === "string" && item.trim() && item.length <= 1_000) ||
      spec.name.length > 120 || spec.purpose.length > 1_000) {
    throw new Error("Invalid artifact specification");
  }

  if (!artifact.files || typeof artifact.files !== "object" || Array.isArray(artifact.files)) {
    throw new Error("Invalid artifact files");
  }
  const fileEntries = Object.entries(artifact.files);
  if (fileEntries.length === 0 || fileEntries.length > 40) {
    throw new Error("Invalid artifact file count");
  }
  let sourceBytes = 0;
  for (const [filePath, source] of fileEntries) {
    if (!filePath || filePath.startsWith("/") || filePath.includes("\\") ||
        filePath.split("/").some(part => !part || part === "." || part === ".." ||
          ["__proto__", "prototype", "constructor"].includes(part))) {
      throw new Error("Unsafe artifact source path");
    }
    if (typeof source !== "string" || source.length > 200_000) {
      throw new Error("Artifact source files must be bounded strings");
    }
    sourceBytes += Buffer.byteLength(source, "utf8");
    if (sourceBytes > MAX_SOURCE_BYTES) throw new Error("Artifact source exceeds 1 MB");
  }

  if (!["draft", "testing", "quarantined", "ready", "active", "retired"].includes(String(artifact.status))) {
    throw new Error("Invalid artifact status");
  }
  if (typeof artifact.createdAt !== "string" || !Number.isFinite(Date.parse(artifact.createdAt))) {
    throw new Error("Invalid artifact timestamp");
  }
  if (artifact.previousDigest !== undefined &&
      (typeof artifact.previousDigest !== "string" || !/^[a-f0-9]{64}$/.test(artifact.previousDigest))) {
    throw new Error("Invalid previous artifact digest");
  }
  if (artifact.testSummary !== undefined) {
    const summary = artifact.testSummary;
    if (!summary || typeof summary.passed !== "boolean" ||
        !Number.isSafeInteger(summary.testsRun) || summary.testsRun < 0 || summary.testsRun > 10_000 ||
        !Number.isSafeInteger(summary.testsPassed) || summary.testsPassed < 0 || summary.testsPassed > summary.testsRun ||
        !Array.isArray(summary.findings) || summary.findings.length > 100 ||
        !summary.findings.every(item => typeof item === "string" && item.length <= 1_000) ||
        typeof summary.completedAt !== "string" || !Number.isFinite(Date.parse(summary.completedAt))) {
      throw new Error("Invalid artifact test summary");
    }
  }
  if ((artifact.status === "ready" || artifact.status === "active") &&
      (!artifact.testSummary?.passed || artifact.testSummary.testsRun < 1 ||
       artifact.testSummary.testsPassed !== artifact.testSummary.testsRun)) {
    throw new Error("Ready artifacts must have a complete passing test summary");
  }

  const canonicalSpec = {
    id: spec.id,
    name: spec.name,
    purpose: spec.purpose,
    specialists: [...spec.specialists],
    change: spec.change,
    requirements: [...spec.requirements]
  };
  const canonicalFiles = Object.keys(artifact.files).sort().map(filePath => [filePath, artifact.files![filePath]]);
  const canonical = JSON.stringify({ spec: canonicalSpec, files: canonicalFiles });
  const expectedDigest = createHash("sha256").update(canonical, "utf8").digest("hex");
  if (artifact.digest !== expectedDigest) throw new Error("Artifact digest does not match its stored source");
}

function cloneArtifact(artifact: ToolArtifact): ToolArtifact {
  return {
    ...artifact,
    spec: {
      ...artifact.spec,
      specialists: [...artifact.spec.specialists],
      requirements: [...artifact.spec.requirements]
    },
    files: { ...artifact.files },
    testSummary: artifact.testSummary ? {
      ...artifact.testSummary,
      findings: [...artifact.testSummary.findings]
    } : undefined
  };
}

import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectAnalysis, ProjectInspector } from "../../../packages/intelligence/director/DirectorCapabilities";

export interface SourceReferenceVerification {
  status: "verified" | "unverified";
  path: string;
  occurrenceCount: number;
  startLine?: number;
  endLine?: number;
  reason?: "invalid_reference" | "unsupported_file_type" | "file_unavailable" |
    "file_too_large" | "quote_not_found" | "ambiguous_match" | "line_range_mismatch";
}

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml", ".toml", ".py", ".swift", ".sh"]);
const DEFAULT_PATHS = ["README.md", "package.json"];
const MAX_FILES = 100;
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

/** Read-only workspace inspection. No writes, process execution, symlink escapes, or hidden recursive crawl. */
export class LocalProjectInspector implements ProjectInspector {
  private readonly root: string;

  private constructor(root: string) {
    this.root = root;
  }

  static async open(root: string): Promise<LocalProjectInspector> {
    if (typeof root !== "string" || !root.trim()) throw new Error("Workspace root is required");
    return new LocalProjectInspector(await realpath(root));
  }

  async inspect(input: { objective: string; paths?: string[] }): Promise<ProjectAnalysis> {
    if (!input || typeof input.objective !== "string" || !input.objective.trim()) {
      throw new Error("Project inspection objective is required");
    }
    const requested = input.paths === undefined ? DEFAULT_PATHS : input.paths;
    if (!Array.isArray(requested) || requested.length > MAX_FILES ||
        requested.some(item => typeof item !== "string" || !item.trim() || item.length > 1024 ||
          path.isAbsolute(item) || item.split(/[\\/]/).includes(".."))) {
      throw new Error("Project inspection paths must be bounded relative paths without traversal");
    }

    const inspected: string[] = [];
    const findings: ProjectAnalysis["findings"] = [];
    let totalBytes = 0;
    for (const relative of [...new Set(requested)]) {
      const loaded = await this.readEligibleTextFile(relative, Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - totalBytes));
      if (!loaded || loaded.reason === "file_too_large" || totalBytes + loaded.byteLength > MAX_TOTAL_BYTES) continue;
      const content = loaded.content;
      totalBytes += loaded.byteLength;
      inspected.push(relative);
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (findings.length < 200 && /\b(TODO|FIXME)\b/.test(lines[index])) {
          findings.push({
            id: relative + ":" + (index + 1),
            category: "optimization",
            title: "Unresolved TODO/FIXME marker",
            detail: lines[index].trim().slice(0, 500),
            evidenceRefs: [relative + ":" + (index + 1)],
            priority: "low"
          });
        }
      }
    }
    return {
      summary: inspected.length
        ? "Read-only inspection covered " + inspected.length + " file(s): " + inspected.join(", ") + "."
        : "No eligible workspace files were available for the requested inspection.",
      findings: findings.slice(0, 200),
      inspectedAt: new Date().toISOString()
    };
  }
  /**
   * Verify an exact excerpt against a bounded file inside this inspector's
   * already-confined workspace. This confirms source presence only; it does
   * not establish exploitability, reachability, authenticity, or authorization.
   */
  async verifySourceReference(input: {
    path: string;
    quote: string;
    startLine?: number;
    endLine?: number;
  }): Promise<SourceReferenceVerification> {
    const relative = input?.path;
    const quote = input?.quote;
    const invalid = (): SourceReferenceVerification => ({
      status: "unverified", path: typeof relative === "string" ? relative : "",
      occurrenceCount: 0, reason: "invalid_reference"
    });
    if (!input || typeof input !== "object") return invalid();
    if (typeof relative !== "string" || !relative.trim() || relative.length > 1024 ||
        path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..") ||
        typeof quote !== "string" || !quote.length || quote.length > 8192 ||
        (input.startLine !== undefined && (!Number.isSafeInteger(input.startLine) || input.startLine < 1)) ||
        relative.includes(String.fromCharCode(0)) ||
        (input.endLine !== undefined && (!Number.isSafeInteger(input.endLine) || input.endLine < 1)) ||
        (input.startLine !== undefined && input.endLine !== undefined && input.startLine > input.endLine)) {
      return invalid();
    }
    const normalizedPath = path.normalize(relative);
    const extension = path.extname(normalizedPath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) {
      return { status: "unverified", path: normalizedPath, occurrenceCount: 0, reason: "unsupported_file_type" };
    }
    const loaded = await this.readEligibleTextFile(normalizedPath);
    if (!loaded) {
      return { status: "unverified", path: normalizedPath, occurrenceCount: 0, reason: "file_unavailable" };
    }
    if (loaded.reason === "file_too_large") {
      return { status: "unverified", path: normalizedPath, occurrenceCount: 0, reason: "file_too_large" };
    }

    const content = loaded.content.replace(/\r\n?/g, "\n");
    const exactQuote = quote.replace(/\r\n?/g, "\n");
    const lineStarts = [0];
    for (let index = 0; index < content.length; index += 1) {
      if (content[index] === "\n") lineStarts.push(index + 1);
    }
    const lineForOffset = (target: number): number => {
      let low = 0;
      let high = lineStarts.length;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (lineStarts[middle] <= target) low = middle + 1;
        else high = middle;
      }
      return low;
    };
    let occurrenceCount = 0;
    let matchingCount = 0;
    let selectedMatch: { startLine: number; endLine: number } | undefined;
    let offset = 0;
    while (offset <= content.length - exactQuote.length) {
      const found = content.indexOf(exactQuote, offset);
      if (found < 0) break;
      occurrenceCount += 1;
      const candidate = {
        startLine: lineForOffset(found),
        endLine: lineForOffset(found + exactQuote.length - 1)
      };
      if ((input.startLine === undefined || candidate.startLine === input.startLine) &&
          (input.endLine === undefined || candidate.endLine === input.endLine)) {
        matchingCount += 1;
        if (matchingCount === 1) selectedMatch = candidate;
      }
      offset = found + 1;
    }
    if (occurrenceCount === 0) {
      return { status: "unverified", path: normalizedPath, occurrenceCount: 0, reason: "quote_not_found" };
    }
    if (matchingCount === 1 && selectedMatch) {
      return { status: "verified", path: normalizedPath, occurrenceCount, ...selectedMatch };
    }
    return {
      status: "unverified", path: normalizedPath, occurrenceCount,
      reason: matchingCount > 1 ? "ambiguous_match" : "line_range_mismatch"
    };
  }

  private async readEligibleTextFile(relative: string, maxBytes = MAX_FILE_BYTES): Promise<
    { content: string; byteLength: number; reason?: never } |
    { content: ""; byteLength: 0; reason: "file_too_large" } |
    undefined
  > {
    if (!TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) return undefined;
    const candidate = path.resolve(this.root, relative);
    if (candidate !== this.root && !candidate.startsWith(this.root + path.sep)) {
      throw new Error("Project inspection path escaped the workspace");
    }
    let actual: string;
    try { actual = await realpath(candidate); } catch { return undefined; }
    if (actual !== this.root && !actual.startsWith(this.root + path.sep)) {
      throw new Error("Project inspection symlink escaped the workspace");
    }
    const metadata = await stat(actual);
    if (!metadata.isFile()) return undefined;
    if (metadata.size > maxBytes) return { content: "", byteLength: 0, reason: "file_too_large" };
    const content = await readFile(actual, "utf8");
    const byteLength = Buffer.byteLength(content, "utf8");
    if (byteLength > maxBytes) return { content: "", byteLength: 0, reason: "file_too_large" };
    return { content, byteLength };
  }
}

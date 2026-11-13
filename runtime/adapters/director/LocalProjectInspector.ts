import { realpath, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectAnalysis, ProjectInspector } from "../../../packages/intelligence/director/DirectorCapabilities";

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
      const extension = path.extname(relative).toLowerCase();
      if (!TEXT_EXTENSIONS.has(extension)) continue;
      const candidate = path.resolve(this.root, relative);
      if (candidate !== this.root && !candidate.startsWith(this.root + path.sep)) {
        throw new Error("Project inspection path escaped the workspace");
      }
      let actual: string;
      try { actual = await realpath(candidate); } catch { continue; }
      if (actual !== this.root && !actual.startsWith(this.root + path.sep)) {
        throw new Error("Project inspection symlink escaped the workspace");
      }
      const metadata = await stat(actual);
      if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES || totalBytes + metadata.size > MAX_TOTAL_BYTES) continue;
      const content = await readFile(actual, "utf8");
      totalBytes += Buffer.byteLength(content, "utf8");
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
}

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { repoRoot } from "./lib.mjs";

const included = [
  "scripts/local-gguf",
  "scripts/custom-gguf",
  "docs/implementation/local-model-setup.md",
  "docs/implementation/llamacpp-inference-provider.md",
  "docs/implementation/apex-evidence-handoff.md",
  "docs/implementation/eagle3-scaffold.md",
  "README.md",
  "package.json"
];

export function bundlePaths() {
  return included.map(item => item.replaceAll("\\", "/"));
}

export function rejectBundlePath(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/");
  const base = path.posix.basename(normalized);
  if (normalized.includes("node_modules/") || base === "node_modules") return "node_modules";
  if (normalized.endsWith(".gguf") || normalized.startsWith("models/")) return "weights";
  if (base === ".env" || base.startsWith(".env.")) return "secrets";
  if (normalized.includes("__pycache__/") || normalized.endsWith(".pyc")) return "bytecode";
  return null;
}

export async function collectBundleFiles() {
  const files = [];
  for (const item of included) {
    const absolute = path.join(repoRoot, item);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      await walk(absolute, item, files);
    } else {
      const reason = rejectBundlePath(item);
      if (reason) throw new Error("Bundle list includes " + reason + ": " + item);
      files.push(item);
    }
  }
  return files.sort();
}

async function walk(directory, relative, files) {
  for (const name of await readdir(directory)) {
    const child = path.posix.join(relative.replaceAll("\\", "/"), name);
    if (rejectBundlePath(child)) continue;
    const absolute = path.join(repoRoot, child);
    const info = await stat(absolute);
    if (info.isDirectory()) await walk(absolute, child, files);
    else files.push(child);
  }
}

export async function bundleManifest() {
  const files = await collectBundleFiles();
  const entries = [];
  for (const file of files) {
    const bytes = await readFile(path.join(repoRoot, file));
    entries.push({ path: file, bytes: bytes.length });
  }
  return { files: entries, excludes: ["*.gguf", "models/", "node_modules/", ".env", "__pycache__/"] };
}

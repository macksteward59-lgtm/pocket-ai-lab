import { createHash } from "node:crypto";
import path from "node:path";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { EXPERIMENTAL_GGUF } from "./launcher-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const ALLOWED_ROOTS = [
  "apps/web",
  "packages/intelligence",
  "runtime/adapters/llama-cpp",
  "runtime/lab",
  "scripts/desktop",
  "docs/implementation/desktop-launcher.md",
  "package.json",
  "README.md"
];

const SKIP_DIRS = new Set(["node_modules", "dist", "models", ".git", "__tests__", "__pycache__", "test"]);
const FORBIDDEN = /(\.env($|\.))|\.gguf$|\.pem$|\.key$|id_rsa|credentials\.json|secret/i;

export function isForbiddenRelative(relative) {
  const normalized = relative.split(path.sep).join("/");
  if (normalized.split("/").some(part => SKIP_DIRS.has(part))) return true;
  if (FORBIDDEN.test(normalized)) return true;
  if (path.basename(normalized) === EXPERIMENTAL_GGUF) return true;
  if (normalized.endsWith(".test.mjs") || normalized.endsWith(".test.ts") || normalized.endsWith(".test.js")) return true;
  return false;
}

export async function collectFiles(root) {
  const files = [];
  for (const entry of ALLOWED_ROOTS) {
    await walk(root, entry, files);
  }
  const lock = path.join(root, "package-lock.json");
  try {
    const info = await stat(lock);
    if (info.isFile()) files.push("package-lock.json");
  } catch {
    // A lockfile is optional. npm install still reads package.json.
  }
  return files.filter(file => !isForbiddenRelative(file)).sort();
}

async function walk(root, relative, files) {
  if (isForbiddenRelative(relative)) return;
  const absolute = path.join(root, relative);
  let info;
  try {
    info = await stat(absolute);
  } catch {
    return;
  }
  if (info.isDirectory()) {
    if (relative.endsWith("/test") || path.basename(relative) === "test") return;
    const entries = await readdir(absolute);
    for (const entry of entries) {
      await walk(root, path.join(relative, entry), files);
    }
    return;
  }
  if (info.isFile()) files.push(relative.split(path.sep).join("/"));
}

export async function assertNoSecrets(root, files) {
  for (const relative of files) {
    if (isForbiddenRelative(relative)) throw new Error("Refusing to package " + relative);
    const absolute = path.join(root, relative);
    const info = await stat(absolute);
    if (info.size > 2_000_000) continue;
    const sample = await readFile(absolute);
    const text = sample.toString("utf8");
    const privateKey = "-----BEGIN " + "PRIVATE KEY-----";
    const opensshKey = "-----BEGIN " + "OPENSSH PRIVATE KEY-----";
    if (text.includes(privateKey) || text.includes(opensshKey)) {
      throw new Error("Refusing to package a private key in " + relative);
    }
  }
}

export async function buildArchive({ root = repoRoot, destDir, archiveName = "pocket-ai-lab-desktop.tar.gz" } = {}) {
  const files = await collectFiles(root);
  if (files.length === 0) throw new Error("The desktop archive would be empty.");
  await assertNoSecrets(root, files);
  const stagingParent = await mkdtemp(path.join(os.tmpdir(), "pocket-desktop-"));
  const staging = path.join(stagingParent, "stage");
  await mkdir(staging, { recursive: true });
  for (const relative of files) {
    await copyInto(path.join(root, relative), path.join(staging, "pocket-ai-lab", relative));
  }
  const launcherFiles = ["launcher.mjs", "launcher-lib.mjs", "start-pocket-ai-lab.sh", "Start Pocket AI Lab.command", "Start Pocket AI Lab.bat"];
  for (const name of launcherFiles) {
    await copyInto(path.join(root, "scripts/desktop", name), path.join(staging, "pocket-ai-lab", name));
  }
  const manifestFiles = [];
  for (const relative of files) {
    const bytes = await readFile(path.join(root, relative));
    manifestFiles.push({ path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const manifest = {
    name: "pocket-ai-lab-desktop",
    kind: "portable-launcher",
    standaloneNativeInstaller: false,
    windowsTested: false,
    macTested: false,
    linuxVerifiedByArchiveBuild: true,
    iphoneIncluded: false,
    weightsIncluded: false,
    experimentalCustomGgufIncluded: false,
    authorized: false,
    production: false,
    prerequisites: [
      "Node.js 22 or newer, installed by you",
      "npm install once in the unpacked folder",
      "Optional llama-server installed by you",
      "Optional local GGUF selected with POCKET_GGUF_PATH or ~/.pocket-ai-lab/model.json"
    ],
    files: manifestFiles
  };
  await writeFile(path.join(staging, "pocket-ai-lab", "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(path.join(staging, "pocket-ai-lab", "START-HERE.txt"), startHere());
  const archivePath = path.join(destDir, archiveName);
  const tempArchive = path.join(stagingParent, archiveName);
  try {
    await tar(staging, tempArchive);
    const archiveBytes = await readFile(tempArchive);
    await mkdir(destDir, { recursive: true });
    await writeFile(archivePath, archiveBytes);
    const sha256 = createHash("sha256").update(archiveBytes).digest("hex");
    await writeFile(archivePath + ".sha256", sha256 + "  " + archiveName + "\n");
    await writeFile(path.join(destDir, "pocket-ai-lab-desktop-manifest.json"), JSON.stringify(manifest, null, 2));
    if (archiveBytes.length === 0) throw new Error("The archive is empty.");
    if (archiveBytes.length > 25 * 1024 * 1024) throw new Error("The archive is larger than 25MB.");
    return { archivePath, sha256, bytes: archiveBytes.length, fileCount: files.length, manifest };
  } finally {
    await rm(stagingParent, { recursive: true, force: true });
  }
}

async function copyInto(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  const data = await readFile(source);
  await writeFile(target, data);
  try {
    const info = await stat(source);
    await chmod(target, info.mode & 0o777);
  } catch {
    // Some artifact filesystems reject mode changes. The file contents are still copied.
  }
}

function startHere() {
  return [
    "Pocket AI Lab portable launcher",
    "",
    "This is not a standalone native installer. It does not install Node, llama-server, or a model.",
    "Windows and macOS scripts are included and have not been run on those systems.",
    "The iPhone app is not in this archive.",
    "No model weights are included. The experimental custom GGUF is not included.",
    "authorized is false. This program does not grant permission.",
    "",
    "First run, while online:",
    "1. Install Node.js 22 or newer yourself.",
    "2. In this folder run: npm install",
    "The launcher will not run that install for you.",
    "",
    "Later runs can stay offline.",
    "Linux: ./start-pocket-ai-lab.sh",
    "macOS: double-click \"Start Pocket AI Lab.command\" after chmod +x, if you choose to try it.",
    "Windows: double-click \"Start Pocket AI Lab.bat\" if you choose to try it.",
    "",
    "The app listens on 127.0.0.1 only. Memory stays in your home directory under .pocket-ai-lab/memory.",
    "To use a model you already have, set POCKET_GGUF_PATH to that .gguf file, or write {\"ggufPath\":\"...\"} to ~/.pocket-ai-lab/model.json.",
    "Install llama-server yourself. The launcher does not download weights."
  ].join("\n");
}

function tar(staging, archivePath) {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", ["-czf", archivePath, "-C", staging, "pocket-ai-lab"], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error("tar exited " + code)));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dest = process.argv[2] || "/opt/cursor/artifacts";
  const result = await buildArchive({ destDir: dest });
  process.stdout.write(result.archivePath + "\n" + result.sha256 + "\n" + result.bytes + "\n");
}

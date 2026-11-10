import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { EXPERIMENTAL_GGUF } from "./launcher-lib.mjs";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

const FORBIDDEN = /(^|\/)(\.env($|\..*)|node_modules|dist|models|\.git|\.governance-inbox|\.governance-outbox)(\/|$)|(\.gguf|\.pem|\.key)$|id_rsa|credentials\.json|(^|\/)secret/i;

export function isForbiddenRelative(relative) {
  const normalized = relative.split(path.sep).join("/");
  if (normalized === ".env.example" || normalized.endsWith("/.env.example")) return false;
  if (path.basename(normalized) === EXPERIMENTAL_GGUF) return true;
  return FORBIDDEN.test(normalized);
}

export async function collectFiles(root) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: root });
  const files = stdout.split("\0").filter(Boolean)
    .map(file => file.split(path.sep).join("/"))
    .filter(file => !isForbiddenRelative(file))
    .sort();
  for (const required of ["scripts/local-gguf/lib.mjs", "scripts/desktop/launcher-lib.mjs", "tsconfig.json", "package.json"]) {
    if (!files.includes(required)) throw new Error("Archive is missing " + required);
  }
  if (!files.some(file => file.endsWith(".test.mjs") || file.endsWith(".test.ts"))) {
    throw new Error("Archive includes no tests, so packaged npm test would not match the repository.");
  }
  return files;
}

export async function assertNoSecrets(root, files) {
  for (const relative of files) {
    if (isForbiddenRelative(relative)) throw new Error("Refusing to package " + relative);
    const absolute = path.join(root, relative);
    const info = await stat(absolute);
    if (info.size > 2_000_000) continue;
    const text = (await readFile(absolute)).toString("utf8");
    const privateKey = "-----BEGIN " + "PRIVATE KEY-----";
    const opensshKey = "-----BEGIN " + "OPENSSH PRIVATE KEY-----";
    if (text.includes(privateKey) || text.includes(opensshKey)) {
      throw new Error("Refusing to package a private key in " + relative);
    }
  }
}

export async function buildArchive({ root = repoRoot, destDir, archiveName = "pocket-ai-lab-desktop.zip" } = {}) {
  const files = await collectFiles(root);
  await assertNoSecrets(root, files);
  const sourceCommit = await gitCommit(root);
  const stagingParent = await mkdtemp(path.join(os.tmpdir(), "pocket-desktop-"));
  const staging = path.join(stagingParent, "stage");
  const packedRoot = path.join(staging, "pocket-ai-lab");
  await mkdir(packedRoot, { recursive: true });
  try {
    for (const relative of files) {
      await copyInto(path.join(root, relative), path.join(packedRoot, relative));
    }
    await writeFile(path.join(packedRoot, "start-pocket-ai-lab.sh"), rootShell(), { mode: 0o755 });
    await writeFile(path.join(packedRoot, "Start Pocket AI Lab.command"), macCommand(), { mode: 0o755 });
    await writeFile(path.join(packedRoot, "Start Pocket AI Lab.bat"), windowsBat());
    const manifestFiles = [];
    for (const relative of files) {
      const bytes = await readFile(path.join(root, relative));
      manifestFiles.push({ path: relative, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    const manifest = {
      name: "pocket-ai-lab-desktop",
      kind: "portable-source-and-launcher",
      sourceCommit,
      scope: "Tracked repository files for this commit, including tests and tsconfig, plus generated root start scripts. The launcher stays at scripts/desktop so its import of scripts/local-gguf/lib.mjs resolves. No node_modules, models, or secrets.",
      standaloneNativeInstaller: false,
      windowsTested: false,
      macTested: false,
      linuxVerifiedByArchiveBuild: true,
      iphoneIncluded: false,
      weightsIncluded: false,
      experimentalCustomGgufIncluded: false,
      authorized: false,
      production: false,
      greetingQualityFixed: false,
      launcherModule: "scripts/desktop/launcher.mjs",
      prerequisites: [
        "Node.js 22 or newer, installed by you",
        "npm install once in the unpacked folder while online",
        "Optional llama-server installed by you",
        "Optional local GGUF selected with POCKET_GGUF_PATH or ~/.pocket-ai-lab/model.json"
      ],
      files: manifestFiles
    };
    await writeFile(path.join(packedRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
    await writeFile(path.join(packedRoot, "START-HERE.txt"), startHere(sourceCommit));
    const archivePath = path.join(destDir, archiveName);
    const tempArchive = path.join(stagingParent, archiveName);
    await zip(staging, tempArchive);
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

async function gitCommit(root) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root });
    return stdout.trim();
  } catch {
    return "unknown";
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
    // Some artifact filesystems reject mode changes. The bytes are still copied.
  }
}

function rootShell() {
  return `#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required. This portable launcher does not install Node and is not a standalone native installer."
  exit 1
fi
exec node scripts/desktop/launcher.mjs "$@"
`;
}

function macCommand() {
  return `#!/bin/sh
cd "$(dirname "$0")"
exec ./start-pocket-ai-lab.sh "$@"
`;
}

function windowsBat() {
  return [
    "@echo off",
    "cd /d \"%~dp0\"",
    "where node >nul 2>&1",
    "if errorlevel 1 (",
    "  echo Node.js 22 or newer is required. This portable launcher does not install Node and is not a standalone native installer.",
    "  exit /b 1",
    ")",
    "node \"scripts\\desktop\\launcher.mjs\" %*",
    ""
  ].join("\r\n");
}

function startHere(sourceCommit) {
  return [
    "Pocket AI Lab portable package",
    "Source commit: " + sourceCommit,
    "",
    "This is not a standalone native installer and not an iPhone app.",
    "Windows and macOS scripts are included and have not been run on those systems.",
    "No model weights are included. The experimental custom GGUF is not included.",
    "A Qwen 0.5B greeting can still be a poor or echoed sentence when the HTTP status is 200. This package does not hide that.",
    "authorized is false. This program does not grant permission.",
    "",
    "First run, while online:",
    "1. Install Node.js 22 or newer yourself.",
    "2. In this folder run: npm install",
    "The launcher will not run that install for you.",
    "After that, npm test and npm run build use the tests and tsconfig.json in this folder.",
    "",
    "Later runs can stay offline.",
    "Linux: ./start-pocket-ai-lab.sh",
    "Headless: ./start-pocket-ai-lab.sh --headless",
    "macOS: double-click \"Start Pocket AI Lab.command\" after chmod +x, if you choose to try it.",
    "Windows: double-click \"Start Pocket AI Lab.bat\" if you choose to try it.",
    "",
    "The start script runs scripts/desktop/launcher.mjs. It listens on 127.0.0.1 only.",
    "Memory stays in your home directory under .pocket-ai-lab/memory.",
    "To use a model you already have, set POCKET_GGUF_PATH to that .gguf file.",
    "Install llama-server yourself. The launcher does not download weights."
  ].join("\n");
}

function zip(staging, archivePath) {
  return new Promise((resolve, reject) => {
    const child = spawn("zip", ["-r", "-X", "-q", archivePath, "pocket-ai-lab"], { cwd: staging });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error("zip exited " + code)));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dest = process.argv[2] || "/opt/cursor/artifacts";
  const result = await buildArchive({ destDir: dest });
  process.stdout.write(result.archivePath + "\n" + result.sha256 + "\n" + result.bytes + "\n");
}

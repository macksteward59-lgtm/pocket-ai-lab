/**
 * Own the loopback sidecar and the export watcher.
 * The parent launcher sends SIGTERM; this process stops both children.
 * It does not contact scan targets and it does not print the Fernet key.
 */
import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const appRoot = process.env.GOVERNANCE_APP_ROOT || process.cwd();
const host = process.env.GOVERNANCE_SIDECAR_HOST || "127.0.0.1";
const port = process.env.GOVERNANCE_SIDECAR_PORT || "8765";
const children = [];
let stopping = false;

function refuseHost() {
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    console.error("Refusing to bind a non-loopback host. Use 127.0.0.1.");
    process.exit(1);
  }
}

function pythonBin() {
  return process.platform === "win32"
    ? path.join(appRoot, ".venv", "Scripts", "python.exe")
    : path.join(appRoot, ".venv", "bin", "python");
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function run(file, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: appRoot, env, stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(file + " exited " + code));
    });
  });
}

async function readDotEnv() {
  const values = {};
  try {
    const text = await readFile(path.join(appRoot, ".env"), "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      values[trimmed.slice(0, index)] = trimmed.slice(index + 1);
    }
  } catch {
    // A missing .env leaves policy encryption unavailable.
  }
  return values;
}

function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { child.kill("SIGTERM"); } catch { /* already gone */ }
  }
}

async function main() {
  refuseHost();
  process.on("SIGTERM", () => { shutdown(); process.exit(0); });
  process.on("SIGINT", () => { shutdown(); process.exit(0); });
  const systemPython = process.env.GOVERNANCE_PYTHON || "python3";
  const venvPython = pythonBin();
  if (!(await exists(venvPython))) {
    await run(systemPython, ["-m", "venv", path.join(appRoot, ".venv")], process.env);
  }
  const probe = spawn(venvPython, ["-c", "import fastapi, uvicorn, pydantic, cryptography, defusedxml"], {
    cwd: appRoot,
    stdio: "ignore"
  });
  const imported = await new Promise(resolve => {
    probe.on("error", () => resolve(false));
    probe.on("exit", code => resolve(code === 0));
  });
  if (!imported) {
    if (stopping) return;
    console.error("Creating the local governance environment. This does not contact scan targets.");
    await run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-e", path.join(appRoot, "services", "ai-integrator-automator")], {
      ...process.env,
      PIP_DISABLE_PIP_VERSION_CHECK: "1"
    });
  }
  if (stopping) return;
  const fileEnv = await readDotEnv();
  const env = {
    ...process.env,
    ...fileEnv,
    GOVERNANCE_SIDECAR_HOST: host,
    GOVERNANCE_SIDECAR_PORT: port,
    GOVERNANCE_AUTHORIZED: "false",
    GOVERNANCE_DASHBOARD_DIR: path.join(appRoot, "scripts", "desktop", "governance-dashboard"),
    GOVERNANCE_ALLOWLIST_FILE: process.env.GOVERNANCE_ALLOWLIST_FILE || path.join(appRoot, ".governance", "allowlist.txt"),
    PYTHONPATH: path.join(appRoot, "services", "ai-integrator-automator", "src") + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : "")
  };
  delete env.LLM_API_KEY;
  await mkdir(path.join(appRoot, ".governance-inbox"), { recursive: true });
  await mkdir(path.join(appRoot, ".governance-outbox"), { recursive: true });
  const sidecar = spawn(venvPython, ["-m", "uvicorn", "ai_integrator.main:app", "--host", host, "--port", String(port)], {
    cwd: appRoot,
    env,
    stdio: ["ignore", "inherit", "inherit"]
  });
  children.push(sidecar);
  const watcher = spawn(process.execPath, [
    "--import", "tsx",
    path.join(appRoot, "scripts", "desktop", "TelemetryWatcher.ts"),
    "--dir", path.join(appRoot, ".governance-inbox"),
    "--out", path.join(appRoot, ".governance-outbox"),
    "--sidecar", "http://127.0.0.1:" + port
  ], { cwd: appRoot, env, stdio: ["ignore", "inherit", "inherit"] });
  children.push(watcher);
  await new Promise(resolve => {
    let pending = children.length;
    const done = () => { if (--pending === 0) resolve(); };
    for (const child of children) child.on("exit", done);
  });
  shutdown();
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "governance runtime failed");
  shutdown();
  process.exitCode = 1;
});

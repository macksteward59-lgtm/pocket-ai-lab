import { spawn } from "node:child_process";
import { accessSync, createReadStream } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLoopbackHost, llamaServerArgv } from "../local-gguf/lib.mjs";

export const OWNED_ARG = "--pocket-ai-lab-owned";
export const EXPERIMENTAL_GGUF = "pocket-ai-lab-experimental-q4_k_m.gguf";

const here = path.dirname(fileURLToPath(import.meta.url));

export function redact(text) {
  return String(text)
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b((?:api[_-]?key|token|secret|password)\s*[=:]\s*)\S+/gi, "$1[redacted]");
}

export function appRootFrom(launcherDir, existsSync) {
  const beside = path.join(launcherDir, "apps", "web", "server.mjs");
  if (existsSync(beside)) return launcherDir;
  const repo = path.resolve(launcherDir, "../..");
  if (existsSync(path.join(repo, "apps", "web", "server.mjs"))) return repo;
  return null;
}

export function dataPaths(home) {
  const root = path.join(home, ".pocket-ai-lab");
  return {
    root,
    memory: path.join(root, "memory"),
    logs: path.join(root, "logs"),
    run: path.join(root, "run"),
    modelConfig: path.join(root, "model.json"),
    state: path.join(root, "run", "launcher-state.json"),
    logFile: path.join(root, "logs", "launcher.log")
  };
}

export function nodeIsNewEnough(version = process.versions.node) {
  const major = Number(String(version).split(".")[0]);
  return Number.isInteger(major) && major >= 22;
}

export async function resolveGgufSelection({ env, home, readText, fileExists }) {
  const fromEnv = typeof env.POCKET_GGUF_PATH === "string" ? env.POCKET_GGUF_PATH.trim() : "";
  let selected = fromEnv;
  let source = fromEnv ? "POCKET_GGUF_PATH" : "";
  if (!selected) {
    const configPath = path.join(home, ".pocket-ai-lab", "model.json");
    if (await fileExists(configPath)) {
      try {
        const parsed = JSON.parse(await readText(configPath));
        if (parsed && typeof parsed.ggufPath === "string") {
          selected = parsed.ggufPath.trim();
          source = "model.json";
        }
      } catch {
        return { path: null, source: "model.json", error: "model.json must be JSON with a ggufPath string. The launcher did not download a model." };
      }
    }
  }
  if (!selected) {
    return {
      path: null,
      source: "",
      error: "No local GGUF is selected. Set POCKET_GGUF_PATH or ~/.pocket-ai-lab/model.json to a .gguf file you already have. This launcher does not download weights, and the experimental custom GGUF is not included."
    };
  }
  if (!selected.toLowerCase().endsWith(".gguf") || path.basename(selected) !== path.basename(selected).replaceAll("/", "").replaceAll("\\", "")) {
    return { path: selected, source, error: "The selected model path must be one existing .gguf file." };
  }
  if (!(await fileExists(selected))) {
    const experimental = path.basename(selected) === EXPERIMENTAL_GGUF;
    const error = experimental
      ? "The experimental custom GGUF is not bundled and is not at the path you selected. The launcher will not rename a base model or download a replacement."
      : "The selected GGUF does not exist at " + selected + ". The launcher will not download one.";
    return { path: selected, source, error };
  }
  if (env.POCKET_GGUF_SHA256 && env.POCKET_GGUF_SHA256.trim()) {
    const expected = env.POCKET_GGUF_SHA256.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      return { path: selected, source, error: "POCKET_GGUF_SHA256 must be 64 hex characters. The file was not loaded." };
    }
    const actual = await sha256File(selected);
    if (actual !== expected) {
      return { path: selected, source, error: "The selected GGUF checksum does not match POCKET_GGUF_SHA256. The launcher left the file in place and did not start llama-server." };
    }
  }
  return { path: selected, source, error: "" };
}

export function childEnv(base, { port, memoryDir, llamaBaseUrl }) {
  const env = { ...base, HOST: "127.0.0.1", PORT: String(port), POCKET_MEMORY_DIR: memoryDir };
  if (llamaBaseUrl) env.LLAMACPP_BASE_URL = llamaBaseUrl;
  for (const key of Object.keys(env)) {
    if (/(^|_)(KEY|TOKEN|SECRET|PASSWORD)$/i.test(key) || key === "LLM_API_KEY") delete env[key];
  }
  if (env.HOST !== "127.0.0.1") env.HOST = "127.0.0.1";
  return env;
}

export function browserCommand(platform, url) {
  if (!isLoopbackUrl(url)) throw new Error("The launcher only opens a loopback URL.");
  if (platform === "win32") return { file: "cmd", args: ["/c", "start", "", url] };
  if (platform === "darwin") return { file: "open", args: [url] };
  return { file: "xdg-open", args: [url] };
}

export function isLoopbackUrl(url) {
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function commandLine(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  if (process.platform === "linux") {
    try {
      const raw = await readFile("/proc/" + pid + "/cmdline");
      return raw.toString("utf8").replaceAll("\0", " ").trim();
    } catch {
      return "";
    }
  }
  return "";
}

export function ownsCommand(command, kind, marker) {
  if (!command) return false;
  if (kind === "web") return command.includes(OWNED_ARG) && command.includes("server.mjs");
  if (kind === "llama") {
    return Boolean(marker) && command.includes(marker) && command.includes("--host") && command.includes("127.0.0.1");
  }
  return false;
}

function missingMessage(code, message) {
  return { code, message, blocking: code === "node" || code === "app" || code === "dependencies" };
}

export async function assessPrerequisites({ env, home, appRoot, fileExists, readText, nodeVersion }) {
  const problems = [];
  if (!nodeIsNewEnough(nodeVersion)) {
    problems.push(missingMessage("node", "Node.js 22 or newer is required. This portable launcher does not install Node and is not a standalone native installer."));
  }
  if (!appRoot) {
    problems.push(missingMessage("app", "The launcher cannot find apps/web/server.mjs. Unpack the archive and start it from that folder."));
  } else {
    const tsx = path.join(appRoot, "node_modules", "tsx", "package.json");
    const zod = path.join(appRoot, "node_modules", "zod", "package.json");
    if (!(await fileExists(tsx)) || !(await fileExists(zod))) {
      problems.push(missingMessage("dependencies", "Dependencies are not installed in this folder. From the unpacked folder run npm install once, while you have a network connection. Later launches stay offline and this program will not run the installer for you."));
    }
  }
  const gguf = await resolveGgufSelection({ env, home, readText, fileExists });
  if (gguf.error) problems.push({ code: "model", message: gguf.error, blocking: false });
  return { problems, gguf };
}

export async function choosePort(preferred, canListen) {
  if (!Number.isInteger(preferred) || preferred < 1024 || preferred > 65535) {
    throw new Error("Port must be an integer from 1024 to 65535.");
  }
  if (await canListen(preferred)) return preferred;
  for (let port = preferred + 1; port < preferred + 20 && port <= 65535; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error("No free loopback port near " + preferred + ". The launcher did not stop any process it does not own.");
}

export function listenAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

async function sha256File(file) {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export function statusText(status) {
  const lines = [];
  if (status.appListening) {
    lines.push("Pocket AI Lab is listening at " + status.url);
  } else {
    lines.push("Pocket AI Lab did not start.");
  }
  if (status.modelReady) {
    lines.push("The local model answered a loopback health check. Model text is not authorization.");
  } else {
    lines.push("The local model is not ready. " + (status.modelMessage || "No model was started."));
  }
  lines.push("Memory stays in " + status.memoryDir);
  lines.push("This is a portable launcher, not a native installer, and it does not authorize anything.");
  if (status.browserOpened) lines.push("The default browser was asked to open the loopback page.");
  else if (status.browserError) lines.push("The browser was not opened: " + status.browserError);
  return lines.join("\n");
}

export async function launch(options = {}) {
  const deps = options.deps ?? {};
  const env = options.env ?? process.env;
  const home = options.home ?? os.homedir();
  const paths = dataPaths(home);
  const launcherDir = options.launcherDir ?? here;
  const exists = deps.fileExists ?? (async file => {
    try {
      await access(file);
      return true;
    } catch {
      return false;
    }
  });
  const readText = deps.readText ?? (file => readFile(file, "utf8"));
  const appRoot = options.appRoot ?? appRootFrom(launcherDir, file => {
    try {
      return deps.existsSync ? deps.existsSync(file) : accessSyncSafe(file);
    } catch {
      return false;
    }
  });
  const assessed = await assessPrerequisites({
    env,
    home,
    appRoot,
    fileExists: exists,
    readText,
    nodeVersion: options.nodeVersion ?? process.versions.node
  });
  const blocking = assessed.problems.filter(item => item.blocking);
  const status = {
    authorized: false,
    production: false,
    appListening: false,
    modelReady: false,
    browserOpened: false,
    url: "",
    memoryDir: paths.memory,
    modelMessage: assessed.gguf.error || "",
    problems: assessed.problems,
    exitCode: blocking.length ? 1 : 0
  };
  if (blocking.length) {
    return { status, stop: async () => {} };
  }

  await mkdir(paths.memory, { recursive: true });
  await mkdir(paths.logs, { recursive: true });
  await mkdir(paths.run, { recursive: true });

  const children = [];
  const canListen = deps.listenAvailable ?? listenAvailable;
  let llama = null;
  if (assessed.gguf.path && !assessed.gguf.error) {
    const binary = (env.LLAMA_SERVER_BIN || "llama-server").trim();
    const binaryFound = binary.includes("/") || binary.includes("\\")
      ? await exists(binary)
      : await (deps.commandExists ?? commandExists)(binary);
    if (!binaryFound) {
      status.modelMessage = "llama-server was not found. Install it yourself and put it on PATH, or set LLAMA_SERVER_BIN. The launcher did not download it. The app will open with the model unavailable.";
    } else {
      const preferred = env.LLAMA_SERVER_PORT ? Number(env.LLAMA_SERVER_PORT) : 8080;
      const port = await choosePort(preferred, canListen);
      const argv = llamaServerArgv({
        binary,
        modelPath: assessed.gguf.path,
        host: "127.0.0.1",
        port,
        context: 8192,
        allowRemote: false
      });
      const child = (deps.spawnLlama ?? defaultSpawn)(argv[0], argv.slice(1), {
        cwd: appRoot,
        env: childEnv(env, { port: webPortPlaceholder(port), memoryDir: paths.memory, llamaBaseUrl: "http://127.0.0.1:" + port }),
        stdio: ["ignore", "pipe", "pipe"]
      });
      wireLogs(child, paths.logFile);
      children.push({ kind: "llama", child, marker: assessed.gguf.path, port });
      llama = { port, baseUrl: "http://127.0.0.1:" + port };
      const healthy = await waitForJson(llama.baseUrl + "/health", body => body && body.status === "ok", deps.fetch ?? globalThis.fetch, 15000);
      if (!healthy) {
        status.modelMessage = "llama-server did not report {\"status\":\"ok\"} on " + llama.baseUrl + "/health. The process this launcher started will be stopped. No reply was invented.";
        await stopChildren(children);
        children.length = 0;
        llama = null;
      }
    }
  }

  const webPreferred = env.PORT ? Number(env.PORT) : 4173;
  const webPort = await choosePort(webPreferred, canListen);
  const llamaBaseUrl = llama ? llama.baseUrl : "http://127.0.0.1:9";
  const webEnv = childEnv(env, { port: webPort, memoryDir: paths.memory, llamaBaseUrl });
  const webArgs = ["--import", "tsx", path.join(appRoot, "apps", "web", "server.mjs"), OWNED_ARG];
  const web = (deps.spawnWeb ?? defaultSpawn)(process.execPath, webArgs, {
    cwd: appRoot,
    env: webEnv,
    stdio: ["ignore", "pipe", "pipe"]
  });
  wireLogs(web, paths.logFile);
  children.push({ kind: "web", child: web, marker: "server.mjs", port: webPort });
  const url = "http://127.0.0.1:" + webPort + "/";
  const listening = await waitForJson(url + "api/health", body => body && body.provider === "llama.cpp", deps.fetch ?? globalThis.fetch, 20000);
  status.url = url;
  status.appListening = listening;
  status.exitCode = listening ? 0 : 1;
  if (!listening) {
    status.modelMessage = status.modelMessage || "The web server did not answer /api/health.";
    await stopChildren(children);
    return { status, stop: async () => {} };
  }
  if (llama) {
    const health = await (deps.fetch ?? globalThis.fetch)(url + "api/health");
    const body = await health.json();
    status.modelReady = Boolean(body.reachable && body.loopback);
    if (!status.modelReady) status.modelMessage = "The app is up, and the loopback model health check did not succeed.";
    else status.modelMessage = "";
  }
  if (options.headless) {
    status.browserError = "Headless mode left the browser closed.";
  } else {
    try {
      const command = browserCommand(options.platform ?? process.platform, url);
      if (deps.openBrowser) await deps.openBrowser(command, url);
      else await openBrowser(command);
      status.browserOpened = true;
    } catch (error) {
      status.browserError = error instanceof Error ? error.message : "browser open failed";
    }
  }
  await writeFile(paths.state, JSON.stringify({
    authorized: false,
    web: { pid: web.pid, port: webPort },
    llama: llama && children.find(item => item.kind === "llama") ? { pid: children.find(item => item.kind === "llama").child.pid, port: llama.port, model: path.basename(assessed.gguf.path) } : null
  }, null, 2));
  await appendLog(paths.logFile, statusText(status));

  return {
    status,
    stop: async () => {
      await stopChildren(children);
      status.appListening = false;
    }
  };
}

function accessSyncSafe(file) {
  try {
    accessSync(file);
    return true;
  } catch {
    return false;
  }
}

function webPortPlaceholder(port) {
  return port;
}

function defaultSpawn(file, args, options) {
  return spawn(file, args, options);
}

async function commandExists(file) {
  return new Promise(resolve => {
    const child = spawn("sh", ["-c", "command -v " + shellSingle(file)], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("exit", code => resolve(code === 0));
  });
}

function shellSingle(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

function wireLogs(child, logFile) {
  const write = chunk => {
    appendLog(logFile, redact(chunk.toString("utf8"))).catch(() => {});
  };
  child.stdout?.on("data", write);
  child.stderr?.on("data", write);
}

async function appendLog(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const { appendFile } = await import("node:fs/promises");
  await appendFile(file, redact(text).replace(/\s*$/, "\n"));
}

async function waitForJson(url, accept, fetchImpl, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetchImpl(url);
      if (response.ok) {
        const body = await response.json();
        if (accept(body)) return true;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
}

async function stopChildren(children) {
  for (const item of children) {
    const command = await commandLine(item.child.pid);
    if (command && !ownsCommand(command, item.kind, item.marker)) continue;
    try {
      item.child.kill("SIGTERM");
    } catch {
      // Already gone.
    }
  }
  await new Promise(resolve => setTimeout(resolve, 200));
}

export async function stopOwnedFromState(stateFile, killPid) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    return { stopped: [], skipped: ["no-state"] };
  }
  const stopped = [];
  const skipped = [];
  for (const kind of ["web", "llama"]) {
    const record = parsed[kind];
    if (!record || !record.pid) continue;
    const command = await commandLine(record.pid);
    const marker = kind === "llama" ? String(record.model || "") : "server.mjs";
    if (!ownsCommand(command, kind, marker)) {
      skipped.push(kind);
      continue;
    }
    await killPid(record.pid);
    stopped.push(kind);
  }
  return { stopped, skipped };
}

export async function openBrowser(command) {
  await new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, { stdio: "ignore", detached: true });
    const timer = setTimeout(() => {
      child.unref();
      resolve();
    }, 1000);
    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(command.file + " exited " + code));
    });
  });
}

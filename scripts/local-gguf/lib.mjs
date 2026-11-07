import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const repoRoot = path.resolve(here, "../..");
export const pinPath = path.join(here, "pin.json");

export async function loadPin(file = pinPath) {
  const pin = JSON.parse(await readFile(file, "utf8"));
  assertPin(pin);
  return pin;
}

export function assertPin(pin) {
  const required = ["id", "filename", "repo", "revision", "sourceUrl", "sha256", "bytes", "license", "baseModel", "purpose"];
  for (const key of required) {
    if (pin?.[key] === undefined || pin[key] === null || pin[key] === "") {
      throw new Error("GGUF pin is missing " + key);
    }
  }
  if (!/^[a-f0-9]{64}$/.test(pin.sha256)) throw new Error("GGUF pin sha256 must be 64 hex characters");
  if (!/^[a-f0-9]{40}$/.test(pin.revision)) throw new Error("GGUF pin revision must be a 40-character commit");
  if (!Number.isInteger(pin.bytes) || pin.bytes <= 0) throw new Error("GGUF pin bytes must be a positive integer");
  if (pin.filename.includes("/") || pin.filename.includes("\\") || !pin.filename.endsWith(".gguf")) {
    throw new Error("GGUF pin filename must be a single .gguf file name");
  }
  const url = new URL(pin.sourceUrl);
  if (url.protocol !== "https:" || url.hostname !== "huggingface.co") {
    throw new Error("GGUF pin source must be https://huggingface.co");
  }
  if (!url.pathname.includes("/" + pin.revision + "/") || !url.pathname.endsWith("/" + pin.filename)) {
    throw new Error("GGUF pin URL must include the pinned revision and filename");
  }
  if (pin.license !== "apache-2.0") throw new Error("GGUF pin license changed; review it before downloading");
  return pin;
}

export function resolveModelDir(env = process.env) {
  const configured = env.POCKET_GGUF_DIR?.trim();
  return path.resolve(configured || path.join(repoRoot, "models"));
}

export function modelDestination(pin, env = process.env) {
  return path.join(resolveModelDir(env), pin.filename);
}

export function allowedDownloadHost(hostname) {
  const name = String(hostname || "").toLowerCase();
  return name === "huggingface.co" || name.endsWith(".huggingface.co") || name.endsWith(".hf.co");
}

export function isLoopbackHost(host) {
  const name = String(host || "").replace(/^\[|\]$/g, "").toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "::1";
}

export function llamaServerArgv(options = {}) {
  const binary = options.binary || "llama-server";
  const modelPath = options.modelPath;
  if (typeof modelPath !== "string" || !modelPath.trim()) {
    throw new Error("A GGUF path is required");
  }
  const host = options.host || "127.0.0.1";
  const port = options.port ?? 8080;
  const context = options.context ?? 2048;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("llama-server port is invalid");
  if (!Number.isInteger(context) || context < 128 || context > 8192) throw new Error("llama-server context is outside the smoke range");
  if (!options.allowRemote && !isLoopbackHost(host)) {
    throw new Error("llama-server stays on loopback unless allowRemote is set");
  }
  return [binary, "-m", modelPath, "--host", host, "--port", String(port), "-c", String(context)];
}

export function shellQuote(value) {
  return "'" + String(value).replaceAll("'", "'\\''") + "'";
}

export function formatLlamaServerCommand(argv) {
  return argv.map(shellQuote).join(" ");
}

export async function sha256File(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export function smokeRecord(fields) {
  return {
    kind: "local-gguf-smoke",
    hardwareAcceptance: false,
    authorized: false,
    apexReceipt: false,
    ...fields
  };
}

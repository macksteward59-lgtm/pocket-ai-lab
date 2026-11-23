import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const worker = fileURLToPath(new URL("../../scripts/custom-gguf/workshop/worker.py", import.meta.url));
const failure = (status, message) => Object.assign(new Error(message), { status });
const validId = value => typeof value === "string" && /^[a-zA-Z0-9_:-]{1,96}$/.test(value);

function requestFor(input) {
  if (input?.op === "list") return { op: "list" };
  if (input?.op === "build" && validId(input.base) && validId(input.teacher) && input.base !== input.teacher &&
      typeof input.name === "string" && input.name.trim() && input.name.trim().length <= 64) {
    return { op: "build", base: input.base, teacher: input.teacher, name: input.name.trim() };
  }
  if (input?.op === "answer" && validId(input.model) && typeof input.question === "string" &&
      input.question.trim() && input.question.length <= 2000) {
    return { op: "answer", model: input.model, question: input.question.trim() };
  }
  throw failure(400, "Select compatible, distinct parents and a candidate name, or supply a model and a prompt.");
}

export function hostWorkshop() {
  let running = false;
  return async input => {
    const request = requestFor(input);
    if (!path.isAbsolute(process.env.POCKET_TRAINING_DIR || "")) {
      if (request.op === "list") return { configured: false, models: [] };
      throw failure(503, "Local-host training is not configured.");
    }
    if (running) throw failure(409, "The training host is busy. Refresh the model list when the job finishes.");
    const env = { PATH: process.env.PATH, POCKET_TRAINING_DIR: process.env.POCKET_TRAINING_DIR,
      HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_HUB_DISABLE_TELEMETRY: "1",
      CUDA_VISIBLE_DEVICES: "", TOKENIZERS_PARALLELISM: "false" };
    for (const name of ["LANG", "LD_LIBRARY_PATH", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP"]) {
      if (process.env[name]) env[name] = process.env[name];
    }
    running = true;
    try {
      const result = await new Promise((resolve, reject) => {
        const child = execFile("python3", ["-B", worker], {
          env, timeout: request.op === "build" ? 1_800_000 : 90_000, killSignal: "SIGKILL", maxBuffer: request.op === "list" ? 262144 : 65536
        }, (error, stdout) => {
          let reply;
          try { reply = JSON.parse(stdout); } catch { /* Handle startup failures and timeouts below. */ }
          if (typeof reply?.error === "string") return reject(failure(422, reply.error.slice(0, 300)));
          if (error || !reply) return reject(failure(503, error?.killed
            ? "Local training host timed out. Refresh to check saved candidates."
            : "The local training worker is unavailable. Check its Python environment."));
          resolve(reply);
        });
        child.stdin.on("error", () => {}); // execFile reports an early worker exit through its callback.
        child.stdin.end(JSON.stringify(request));
      });
      return { ...result, configured: true };
    } finally { running = false; }
  };
}

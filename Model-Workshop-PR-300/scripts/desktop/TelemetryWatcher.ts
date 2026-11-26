/**
 * Watch a local directory and post scanner exports to the loopback sidecar.
 * Target URIs inside an export are not requested.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { watchOnce } from "../../packages/intelligence/governance/watchInbox";
import { assertLoopback } from "../../packages/intelligence/security/PolicyChecker";
import { rotateIfNeeded } from "./LogRotator";

interface WatcherArgs {
  dir: string;
  out: string;
  sidecar: string;
  once: boolean;
  intervalMs: number;
}

function args(argv: string[]): WatcherArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    if (token === "--once") {
      flags.add("once");
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(token + " needs a value");
    values.set(token.slice(2), value);
    index += 1;
  }
  const sidecar = values.get("sidecar") ?? "http://127.0.0.1:8765";
  assertLoopback(sidecar);
  return {
    dir: values.get("dir") ?? ".governance-inbox",
    out: values.get("out") ?? ".governance-outbox",
    sidecar,
    once: flags.has("once"),
    intervalMs: Number(values.get("interval") ?? "5") * 1000
  };
}

async function main(): Promise<void> {
  const options = args(process.argv.slice(2));
  await mkdir(options.dir, { recursive: true });
  await mkdir(options.out, { recursive: true });
  const logPath = path.join(options.out, "watcher.log");
  do {
    const result = await watchOnce({
      inbox: options.dir,
      outbox: options.out,
      sidecarUrl: options.sidecar
    });
    const line = new Date().toISOString() + " submitted=" + result.submitted.length + " skipped=" + result.skipped.length + "\n";
    await rotateIfNeeded(logPath, 64 * 1024, 3);
    const { appendFile } = await import("node:fs/promises");
    await appendFile(logPath, line, "utf8");
    if (options.once) return;
    await new Promise(resolve => setTimeout(resolve, options.intervalMs));
  } while (!options.once);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "watcher failed");
  process.exitCode = 1;
});

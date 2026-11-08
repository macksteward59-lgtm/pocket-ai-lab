import path from "node:path";
import { fileURLToPath } from "node:url";
import { launch, redact, statusText } from "./launcher-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const headless = process.argv.includes("--headless") || process.env.POCKET_LAUNCHER_HEADLESS === "1";
  const handle = await launch({ launcherDir: here, headless });
  process.stdout.write(redact(statusText(handle.status)) + "\n");
  if (handle.status.exitCode !== 0) process.exit(handle.status.exitCode);
  const shutdown = async () => {
    await handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

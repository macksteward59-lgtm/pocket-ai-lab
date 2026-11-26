import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { launch, redact, statusText } from "./launcher-lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const usage = [
  "Usage: start-pocket-ai-lab [--headless] [--no-governance]",
  "  --headless       Start the loopback app without opening a browser.",
  "  --no-governance  Do not start the governance review dashboard.",
  "  -h, --help       Show this help without launching anything."
].join("\n");

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let flags;
  try {
    flags = parseArgs({ options: {
      headless: { type: "boolean" },
      "no-governance": { type: "boolean" },
      help: { type: "boolean", short: "h" }
    } }).values;
  } catch (error) {
    console.error(error.message + "\n" + usage);
    process.exit(2);
  }
  if (flags.help) {
    console.log(usage);
    process.exit(0);
  }
  const headless = flags.headless === true || process.env.POCKET_LAUNCHER_HEADLESS === "1";
  const governance = flags["no-governance"] !== true && process.env.POCKET_NO_GOVERNANCE !== "1";
  const handle = await launch({ launcherDir: here, headless, governance });
  process.stdout.write(redact(statusText(handle.status)) + "\n");
  if (handle.status.exitCode !== 0) process.exit(handle.status.exitCode);
  const shutdown = async () => {
    await handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

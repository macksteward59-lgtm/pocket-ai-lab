/**
 * Copy .env.example to .env when .env is absent.
 * The example file must keep GOVERNANCE_AUTHORIZED=false and an empty Fernet key.
 */
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

export async function setupEnv({ root, force = false } = {}) {
  const examplePath = path.join(root, ".env.example");
  const destPath = path.join(root, ".env");
  const sample = await readFile(examplePath, "utf8");
  if (!/^GOVERNANCE_AUTHORIZED=false\s*$/m.test(sample)) {
    throw new Error(".env.example must keep GOVERNANCE_AUTHORIZED=false");
  }
  if (!/^GOVERNANCE_FERNET_KEY=\s*$/m.test(sample)) {
    throw new Error(".env.example must not contain a Fernet key");
  }
  try {
    await access(destPath);
    if (!force) return { created: false, path: destPath };
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await writeFile(destPath, sample, { encoding: "utf8", mode: 0o600 });
  return { created: true, path: destPath };
}

function isNotFound(error) {
  return error && error.code === "ENOENT";
}

if (import.meta.url === new URL(process.argv[1], "file:").href || process.argv[1]?.endsWith("setup-env.mjs")) {
  const root = process.cwd();
  setupEnv({ root, force: process.argv.includes("--force") })
    .then(result => {
      console.log(result.created ? "Wrote .env from .env.example" : ".env already exists");
      console.log("GOVERNANCE_AUTHORIZED stays false");
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : "setup failed");
      process.exitCode = 1;
    });
}

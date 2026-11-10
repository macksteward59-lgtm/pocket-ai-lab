/**
 * Copy .env.example to .env when .env is absent, then fill an empty Fernet key.
 * The example file stays empty. The key is written only to the gitignored .env.
 */
import { randomBytes } from "node:crypto";
import { readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

export function generateFernetKey() {
  return randomBytes(32).toString("base64").replaceAll("+", "-").replaceAll("/", "_");
}

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
  let created = false;
  let current = sample;
  try {
    await access(destPath);
    if (!force) current = await readFile(destPath, "utf8");
  } catch (error) {
    if (!isNotFound(error)) throw error;
    created = true;
  }
  const key = generateFernetKey();
  let next = current;
  let keyGenerated = false;
  if (!/^GOVERNANCE_FERNET_KEY=\S+/m.test(next)) {
    if (/^GOVERNANCE_FERNET_KEY=\s*$/m.test(next)) {
      next = next.replace(/^GOVERNANCE_FERNET_KEY=\s*$/m, "GOVERNANCE_FERNET_KEY=" + key);
    } else {
      next = next.replace(/\s*$/, "\n") + "GOVERNANCE_FERNET_KEY=" + key + "\n";
    }
    keyGenerated = true;
  }
  if (!/^GOVERNANCE_AUTHORIZED=false\s*$/m.test(next)) {
    throw new Error(".env must keep GOVERNANCE_AUTHORIZED=false");
  }
  if (created || keyGenerated || force) {
    await writeFile(destPath, next, { encoding: "utf8", mode: 0o600 });
  }
  return { created, keyGenerated, path: destPath };
}

function isNotFound(error) {
  return error && error.code === "ENOENT";
}

if (import.meta.url === new URL(process.argv[1], "file:").href || process.argv[1]?.endsWith("setup-env.mjs")) {
  const root = process.cwd();
  setupEnv({ root, force: process.argv.includes("--force") })
    .then(result => {
      console.log(result.created ? "Wrote .env from .env.example" : ".env already exists");
      if (result.keyGenerated) console.log("Generated a local Fernet key in .env");
      console.log("GOVERNANCE_AUTHORIZED stays false");
    })
    .catch(error => {
      console.error(error instanceof Error ? error.message : "setup failed");
      process.exitCode = 1;
    });
}

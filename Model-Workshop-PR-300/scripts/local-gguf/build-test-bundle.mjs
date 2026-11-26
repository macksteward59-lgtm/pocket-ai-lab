import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { collectBundleFiles } from "./bundle.mjs";
import { repoRoot } from "./lib.mjs";

const execFileAsync = promisify(execFile);
const destination = process.argv[2] || "/opt/cursor/artifacts/pocket-ai-lab-local-test-bundle.tar.gz";
const files = await collectBundleFiles();
await mkdir(path.dirname(destination), { recursive: true });
await execFileAsync("tar", ["-czf", destination, "-C", repoRoot, ...files]);
console.log(JSON.stringify({ path: destination, files: files.length, includesWeights: false }));

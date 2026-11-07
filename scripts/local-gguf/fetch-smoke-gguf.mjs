import { createHash } from "node:crypto";
import { writeFile, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { allowedDownloadHost, loadPin, modelDestination, sha256File } from "./lib.mjs";

const pin = await loadPin();
const destination = modelDestination(pin);
await mkdir(path.dirname(destination), { recursive: true });

try {
  const existing = await stat(destination);
  if (existing.isFile() && existing.size === pin.bytes && await sha256File(destination) === pin.sha256) {
    console.log(JSON.stringify({ path: destination, verified: true, downloaded: false, sha256: pin.sha256 }));
    process.exit(0);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const response = await fetch(pin.sourceUrl, { redirect: "follow" });
if (!response.ok) throw new Error("GGUF download failed with HTTP " + response.status);
const finalHost = new URL(response.url).hostname;
if (!allowedDownloadHost(finalHost)) {
  throw new Error("GGUF download redirected off Hugging Face");
}
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.length !== pin.bytes) throw new Error("GGUF download size " + bytes.length + " does not match the pin");
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== pin.sha256) throw new Error("GGUF checksum mismatch");
const partial = destination + ".partial";
await rm(partial, { force: true });
await writeFile(partial, bytes, { flag: "wx" });
await rename(partial, destination);
console.log(JSON.stringify({
  path: destination,
  verified: true,
  downloaded: true,
  sha256: digest,
  bytes: pin.bytes,
  license: pin.license,
  revision: pin.revision
}));

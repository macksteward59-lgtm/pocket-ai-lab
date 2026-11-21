import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadPinnedModel } from "../local-gguf/download.mjs";
import { loadFrozenProfile } from "./profile.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (process.argv.length !== 3) throw new Error("Usage: node scripts/tool-workshop/prepare-model.mjs OUTPUT_FILE");
const { profile } = await loadFrozenProfile();
const pins = JSON.parse(await readFile(path.join(root, "scripts/local-gguf/pins.json"), "utf8"));
const pin = pins.models.find(item => item.id === profile.modelId);
assert(pin, "Frozen workshop model must exist in the approved local pin catalog.");
assert.equal(pin.sha256, profile.modelSHA256);
assert.equal(pin.bytes, profile.modelBytes);
const result = await downloadPinnedModel(pin, { destination: process.argv[2], timeoutMs: 300000 });
console.log(JSON.stringify({ path: result.path, sha256: result.sha256, verified: result.verified }));

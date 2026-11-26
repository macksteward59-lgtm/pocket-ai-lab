import assert from "node:assert/strict";
import test from "node:test";
import { bundlePaths, rejectBundlePath } from "./bundle.mjs";

test("the testing bundle keeps weights, secrets, and install junk out", () => {
  assert.equal(rejectBundlePath("models/qwen.gguf"), "weights");
  assert.equal(rejectBundlePath("node_modules/vitest/package.json"), "node_modules");
  assert.equal(rejectBundlePath(".env"), "secrets");
  assert.equal(rejectBundlePath("scripts/custom-gguf/__pycache__/harness.pyc"), "bytecode");
  assert.equal(rejectBundlePath("scripts/local-gguf/pins.json"), null);
  for (const item of bundlePaths()) assert.equal(rejectBundlePath(item), null);
});

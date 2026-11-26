import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { modelRecord, sources } from "../model-workshop/catalog.js";
import { evaluate, features, forward, readWeights, train } from "../model-workshop/reader.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const asset = name => readFileSync(new URL("../model-workshop/" + name + ".json", import.meta.url));
const hard = JSON.parse(asset("hard")), soft = JSON.parse(asset("soft"));
const training = JSON.parse(asset("training")), evaluation = JSON.parse(asset("evaluation"));

test("bundled weights and documents match the pinned pilot and Python reference", () => {
  for (const [name, hash] of Object.entries(sources)) {
    assert.equal(createHash("sha256").update(asset(name)).digest("hex"), hash);
  }
  const reference = JSON.parse(execFileSync("python3", ["-c", `
import json, sys
from pathlib import Path
p = Path("tools/public-source-distillation")
sys.path.insert(0, str(p))
from experiment import training_docs, validate
from student import predict
train = training_docs()
heldout = json.loads((p / "heldout.json").read_bytes())
validate(train)
validate(heldout, train)
net = json.load(sys.stdin)
print(json.dumps([train, heldout, [predict(net, q, d["sentences"]) for d in train + heldout for q, _ in d["questions"]]]))
`], { cwd: root, input: JSON.stringify(hard), encoding: "utf8" }));
  assert.deepEqual(training, reference[0]);
  assert.deepEqual(evaluation, reference[1]);
  const scores = [...training, ...evaluation].flatMap(doc => doc.questions.map(([q]) =>
    features(q, doc.sentences).map(row => forward(hard, row).score)));
  scores.forEach((row, i) => row.forEach((value, j) => assert.ok(Math.abs(value - reference[2][i][j]) < 1e-12)));
});

test("each role affects fitting and all three readers are scored on the same held-out questions", async () => {
  const originals = JSON.stringify([hard, soft]);
  const child = train(soft, hard, training);
  const reverse = train(hard, soft, training);
  assert.equal(JSON.stringify([hard, soft]), originals);
  assert.equal(child.verifiedPairs, 62);
  assert.equal(reverse.verifiedPairs, 61);
  assert.deepEqual(train(soft, hard, training), child);
  assert.notDeepEqual(child.weights, train(soft, soft, training).weights);
  assert.notDeepEqual(child.weights, train(hard, hard, training).weights);
  assert.deepEqual([soft, hard, child.weights, reverse.weights].map(w => evaluate(w, evaluation).correct), [14, 15, 15, 14]);
  const restored = await modelRecord(JSON.parse(JSON.stringify(child.weights)), "Restored");
  assert.deepEqual(restored.weights, child.weights);
  assert.notDeepEqual(train(restored.weights, soft, training).weights, restored.weights);
});

test("incompatible imports and a teacher with only one verified label are rejected", () => {
  assert.throws(() => readWeights({ ...hard, version: 2 }), /compatible/);
  assert.throws(() => readWeights({ ...hard, features: [...hard.features].reverse() }), /compatible/);
  assert.throws(() => readWeights({ ...hard, output: [1] }), /compatible/);
  assert.throws(() => readWeights({ ...hard, intercept: Infinity }), /compatible/);
  assert.throws(() => train(soft, { ...hard, intercept: 1000 }, training), /both supported and missing/);
});

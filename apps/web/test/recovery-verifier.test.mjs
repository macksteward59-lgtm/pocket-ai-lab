import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID, sign } from "node:crypto";
import test from "node:test";
import { verifyReviewEvidence } from "../recovery/verify.js";

test("verify the signature, expected account/task, displayed passage, position and correction history", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const key = publicKey.export({ format: "jwk" });
  const changedKey = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
  const payload = { schema: "pocket.source-review.v1", taskId: randomUUID(), attemptId: randomUUID(), owner: "orchard",
    title: "Field note", source: "🍎 North plot", quote: "North", offset: 3, executionCount: 1,
    corrections: [{ id: randomUUID(), note: "Confirmed during the second visit." }] };
  const expected = { owner: payload.owner, taskId: payload.taskId, title: payload.title, source: payload.source, quote: payload.quote };
  const signed = record => ({ payload: record, signature: sign("sha256", Buffer.from(JSON.stringify(record)), {
    key: privateKey, dsaEncoding: "ieee-p1363"
  }).toString("base64") });
  const receipt = signed(payload);
  assert.deepEqual(await verifyReviewEvidence(receipt, key, expected), payload);
  await assert.rejects(verifyReviewEvidence(receipt, changedKey, expected), /signature/);
  await assert.rejects(verifyReviewEvidence(receipt, key, { ...expected, owner: "another" }), /expected account/);
  await assert.rejects(verifyReviewEvidence(receipt, key, { ...expected, taskId: randomUUID() }), /expected account/);
  for (const field of ["title", "source", "quote"]) {
    await assert.rejects(verifyReviewEvidence(receipt, key, { ...expected, [field]: "changed" }), /displayed/);
  }
  await assert.rejects(verifyReviewEvidence({ ...receipt, payload: { ...payload, title: "Edited" } }, key, expected), /signature/);
  await assert.rejects(verifyReviewEvidence(signed({ ...payload, offset: 2 }), key, expected), /position/);
  await assert.rejects(verifyReviewEvidence(signed({ ...payload, corrections: [...payload.corrections, ...payload.corrections] }), key, expected), /correction/);
});

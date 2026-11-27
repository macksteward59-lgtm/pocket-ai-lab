import { readFile } from "node:fs/promises";
import { verifyReviewEvidence } from "../apps/web/recovery/verify.js";

const [receiptFile, publicKeyFile, owner, taskId] = process.argv.slice(2);
if (!receiptFile || !publicKeyFile || !owner || !taskId || process.argv.length !== 6) {
  console.error("Usage: node tools/verify-review-task.mjs RECEIPT.json TRUSTED-PUBLIC-KEY.json OWNER TASK-UUID");
  process.exitCode = 2;
} else {
  try {
    const readJson = async file => JSON.parse(await readFile(file, "utf8"));
    const record = await verifyReviewEvidence(await readJson(receiptFile), await readJson(publicKeyFile), { owner, taskId });
    console.log(JSON.stringify({ verified: true, owner, taskId, attemptId: record.attemptId,
      executionCount: record.executionCount, corrections: record.corrections.length }));
  } catch (error) {
    console.error("Review verification failed.", error.message);
    process.exitCode = 1;
  }
}

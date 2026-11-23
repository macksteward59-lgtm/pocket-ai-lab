// This reader uses only the receipt, an independently supplied public key and the expected task identity.
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fields = ["schema", "taskId", "attemptId", "owner", "title", "source", "quote", "offset", "executionCount", "corrections"];

function hasFields(value, names) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
}

export async function verifyReviewEvidence(evidence, publicKey, expected) {
  if (!hasFields(evidence, ["payload", "signature"]) || !hasFields(evidence.payload, fields)) {
    throw new Error("The evidence format is incomplete or unsupported.");
  }
  const record = evidence.payload;
  if (!expected || !uuid.test(expected.taskId) || !expected.owner || record.taskId !== expected.taskId ||
      record.owner !== expected.owner || record.schema !== "pocket.source-review.v1" ||
      typeof record.attemptId !== "string" || !uuid.test(record.attemptId) || record.executionCount !== 1) {
    throw new Error("The evidence does not match the expected account, task or execution.");
  }
  if (typeof evidence.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(evidence.signature) ||
      !publicKey || publicKey.kty !== "EC" || publicKey.crv !== "P-256" || "d" in publicKey) {
    throw new Error("A P-256 review signature and a separate public verification key are required.");
  }
  const key = await crypto.subtle.importKey("jwk", publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signature = Uint8Array.from(atob(evidence.signature), character => character.charCodeAt(0));
  const verified = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature,
    new TextEncoder().encode(JSON.stringify(record)));
  if (!verified) throw new Error("The evidence signature did not verify.");

  if (typeof record.title !== "string" || !record.title.trim() || typeof record.source !== "string" ||
      typeof record.quote !== "string" || !record.quote.trim() || !Number.isSafeInteger(record.offset) ||
      record.offset < 0 || record.source.indexOf(record.quote) !== record.offset ||
      record.source.indexOf(record.quote, record.offset + 1) !== -1) {
    throw new Error("The signed excerpt does not match a unique position in the source.");
  }
  if (!Array.isArray(record.corrections)) throw new Error("The correction history is invalid.");
  const ids = new Set();
  for (const change of record.corrections) {
    if (!hasFields(change, ["id", "note"]) || typeof change.id !== "string" || !uuid.test(change.id) ||
        ids.has(change.id) || typeof change.note !== "string" || !change.note.trim()) {
      throw new Error("The correction history is invalid.");
    }
    ids.add(change.id);
  }
  return record;
}

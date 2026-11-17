import assert from "node:assert/strict";
import {
  OWASP_KNOWLEDGE_CATALOG,
  getOwaspSource,
  getOwaspSourcesForAgent,
  getOwaspSourcesForPack,
  getOwaspSourcesForTopics,
  isOwaspReferenceUntrusted
} from "../knowledge";

assert.equal(OWASP_KNOWLEDGE_CATALOG.schemaVersion, 1);
assert.equal(OWASP_KNOWLEDGE_CATALOG.repository.name, "OWASP/CheatSheetSeries");
assert.equal(OWASP_KNOWLEDGE_CATALOG.sources.length, 8);

for (const source of OWASP_KNOWLEDGE_CATALOG.sources) {
  assert.match(source.id, /^OWASP-/);
  assert.match(source.url, /^https:\/\/github\.com\/OWASP\/CheatSheetSeries\/blob\/master\//);
  assert.match(source.blobSha, /^[a-f0-9]{40}$/);
  assert.ok(source.topics.length > 0);
  assert.ok(source.agents.length > 0);
  assert.equal(source.trust, "untrusted-reference");
  assert.equal(isOwaspReferenceUntrusted(source.id), true);
}

assert.equal(getOwaspSource("OWASP-AGENT-EVIDENCE")?.blobSha.length, 40);
assert.ok(getOwaspSourcesForAgent("security-analyst").length >= 5);
assert.ok(getOwaspSourcesForPack("evidence").some(source => source.id === "OWASP-AGENT-EVIDENCE"));
assert.ok(getOwaspSourcesForTopics(["rag-poisoning"]).some(source => source.id === "OWASP-LLM-PROMPT-INJECTION"));
assert.deepEqual(getOwaspSourcesForTopics(["topic-that-does-not-exist"]), []);
assert.equal(isOwaspReferenceUntrusted("unknown-source"), true);

console.log("OWASP knowledge catalog checks passed.");

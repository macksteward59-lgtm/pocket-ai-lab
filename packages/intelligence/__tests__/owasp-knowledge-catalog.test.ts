import assert from "node:assert/strict";
import {
  OWASP_GUIDANCE,
  getOwaspGuidanceForAgent,
  getOwaspGuidanceForSource,
  getOwaspGuidanceForTopics,
  getOwaspGuidanceTrust
} from "../knowledge/owaspGuidance";
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
assert.match(OWASP_KNOWLEDGE_CATALOG.repository.revision, /^[a-f0-9]{40}$/);
assert.equal(OWASP_KNOWLEDGE_CATALOG.sources.length, 8);
assert.ok(Object.isFrozen(OWASP_KNOWLEDGE_CATALOG));
assert.ok(Object.isFrozen(OWASP_KNOWLEDGE_CATALOG.sources));
assert.ok(Object.isFrozen(OWASP_KNOWLEDGE_CATALOG.sources[0].topics));

for (const source of OWASP_KNOWLEDGE_CATALOG.sources) {
  assert.match(source.id, /^OWASP-/);
  assert.ok(source.url.startsWith(`https://github.com/OWASP/CheatSheetSeries/blob/${OWASP_KNOWLEDGE_CATALOG.repository.revision}/`));
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

assert.equal(OWASP_GUIDANCE.length, 8);
assert.ok(Object.isFrozen(OWASP_GUIDANCE));
assert.ok(Object.isFrozen(OWASP_GUIDANCE[0]));
assert.ok(Object.isFrozen(OWASP_GUIDANCE[0].controls));
assert.ok(Object.isFrozen(getOwaspGuidanceForAgent("security-analyst")[0].agents));
assert.ok(getOwaspGuidanceForAgent("security-analyst").length >= 6);
assert.ok(getOwaspGuidanceForSource("OWASP-AGENT-EVIDENCE").some(item => item.id === "EXECUTION-EVIDENCE-REVIEW"));
assert.ok(getOwaspGuidanceForTopics(["rag-poisoning"]).some(item => item.id === "PROMPT-INJECTION-BOUNDARY"));
assert.equal(getOwaspGuidanceTrust("OWASP-AI-AGENT"), "untrusted-reference");
assert.equal(getOwaspGuidanceTrust("unknown-source"), "untrusted-reference");
assert.ok(OWASP_GUIDANCE.every(item => item.controls.length > 0 && item.validation.length > 0));

console.log("OWASP knowledge catalog and guidance checks passed.");

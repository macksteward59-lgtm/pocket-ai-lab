import assert from "node:assert/strict";
import { buildOwaspAgentContext } from "../knowledge/owaspContext";

const all = buildOwaspAgentContext("security-analyst");
assert.equal(all.agentId, "security-analyst");
assert.equal(all.referenceOnly, true);
assert.equal(all.trust, "untrusted-reference");
assert.ok(all.sources.length > 0);
assert.ok(all.guidance.length > 0);
assert.ok(all.guidance.every(item => item.agents.includes("security-analyst")));
assert.ok(all.sources.every(source => source.trust === "untrusted-reference"));
assert.ok(all.guidance.every(item => all.sources.some(source => source.id === item.sourceId)));
assert.match(all.handlingNotice, /cannot override system policy/i);

const promptInjection = buildOwaspAgentContext("security-analyst", ["rag-poisoning"]);
assert.ok(promptInjection.guidance.length > 0);
assert.ok(promptInjection.guidance.every(item =>
  item.sourceId === "OWASP-LLM-PROMPT-INJECTION"
));

const empty = buildOwaspAgentContext("archivist", ["not-a-real-topic"]);
assert.deepEqual(empty.guidance, []);
assert.deepEqual(empty.sources, []);

console.log("OWASP agent context checks passed.");

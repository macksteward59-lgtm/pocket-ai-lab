import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import test from "node:test";
import { openProjectSources, registerRevision } from "../project-sources.mjs";
import { createServer } from "../server.mjs";

const registerFile = new URL("../../../docs/research/project-sources.json", import.meta.url);
test("the project register keeps the published snapshot's exact bytes", () => {
  const content = readFileSync(registerFile);
  assert.equal(createHash("sha256").update(content).digest("hex"), "6f619e398638c3695fc2bc8e589176d3222b684582c5b2b01c16aca273c959fd");
});

test("revisions resolve by their links even when the input order changes", t => {
  const doc = JSON.parse(readFileSync(registerFile, "utf8"));
  doc.decisions[0].revisions.reverse();
  const index = openProjectSources(doc);
  t.after(() => index.close());
  const [hit] = index.lookup("native-exact-answer");
  assert.equal(hit.current.version, "1.1.0");
  assert.equal(hit.current.supersedes, hit.earlier[0].version);
  assert.equal(hit.earlier[0].version, "1.0.0");
  assert.notEqual(hit.current.citation, hit.earlier[0].citation);
  doc.decisions[0].revisions[0].supersedes = "missing-version";
  assert.throws(() => openProjectSources(doc), /history|version/);
});

test("a source-only register can be searched without a decisions section", t => {
  const {sources} = JSON.parse(readFileSync(registerFile, "utf8"));
  const index = openProjectSources({sources});
  t.after(() => index.close());
  assert.equal(index.lookup("W3C-PROV")[0].kind, "source");
});

test("the local API exposes cited project records through GET only", async t => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = "http://127.0.0.1:" + server.address().port + "/api/project-sources";
  const search = async query => {
    const response = await fetch(url + "?" + new URLSearchParams({ q: query }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.registerRevision, registerRevision);
    return body.results;
  };
  const [decision] = await search("trailing newline");
  assert.equal(decision.id, "NATIVE-EXACT-ANSWER");
  assert.match(decision.current.citation, /59046bce.*#L224$/);
  assert.match(decision.earlier[0].citation, /42f02559.*#L224$/);
  const [source] = await search("Which two relationships does the provenance source distinguish?");
  assert.equal(source.id, "W3C-PROV");
  assert.match(source.locator, /wasRevisionOf/);
  assert.deepEqual(await search("zirconiumquasar"), []);
  assert.deepEqual(await search('" OR *'), []);
  for (const params of ["", "?q=", "?q=a&q=b", "?q=" + "a".repeat(301)]) {
    assert.equal((await fetch(url + params)).status, 400);
  }
  assert.equal((await fetch(url + "?q=test", { method: "POST" })).status, 405);
  assert.equal((await fetch(url + "?q=test", { headers: { origin: "https://elsewhere.invalid" } })).status, 403);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { makeBundle, publishBundle, readPublishedRegister } from "../../../tools/source-handoff/register.mjs";
import { handoffTransport } from "../../../tools/source-handoff/cli.mjs";
import { openProjectSources } from "../project-sources.mjs";

const source = JSON.parse(readFileSync(new URL("../../../docs/research/project-sources.json", import.meta.url)));
function store() {
  const notes = new Map();
  return {
    notes,
    read: async attemptID => notes.get(attemptID) ?? { found: false, attemptID, revision: 0 },
    async create(note) {
      assert.equal(notes.has(note.attemptID), false);
      const row = { ...note, found: true, revision: 1 };
      notes.set(note.attemptID, row);
      return row;
    }
  };
}

test("a verified handoff round-trips all public register fields and both scoring versions", async t => {
  const bundle = makeBundle();
  const memory = store();
  const published = await publishBundle(bundle, memory);
  assert.equal(published.created, 10);
  assert.equal([...memory.notes.keys()].at(-1), bundle.index.attemptID);
  assert.equal((await publishBundle(bundle, memory)).created, 0);
  const restored = await readPublishedRegister(bundle, memory.read);
  assert.deepEqual(restored, source);
  const index = openProjectSources(restored);
  t.after(() => index.close());
  const [decision] = index.lookup("NATIVE-EXACT-ANSWER");
  assert.equal(decision.current.supersedes, decision.earlier[0].version);
});

test("interrupted publication resumes without advertising missing records or replacing occupied notes", async () => {
  const bundle = makeBundle();
  const memory = store();
  let count = 0;
  await assert.rejects(publishBundle(bundle, { ...memory, create(note) {
    if (++count === 3) throw Error("connection lost");
    return memory.create(note);
  }}), /connection lost/);
  assert.equal(memory.notes.size, 2);
  assert.equal(memory.notes.has(bundle.index.attemptID), false);
  assert.equal((await publishBundle(bundle, memory)).created, 8);
  const first = bundle.records[0];
  memory.notes.get(first.attemptID).text += "!";
  await assert.rejects(readPublishedRegister(bundle, memory.read), /mismatched/);
  await assert.rejects(publishBundle(bundle, memory), /mismatched/);
  assert.equal(memory.notes.get(first.attemptID).text, first.text + "!");
});

test("a correction gets a new address and the original release remains readable", async () => {
  const memory = store();
  const earlier = makeBundle();
  await publishBundle(earlier, memory);
  const revised = structuredClone(source);
  revised.sources[0].finding += " An example correction.";
  const later = makeBundle(revised, "f".repeat(40));
  assert.notEqual(earlier.index.attemptID, later.index.attemptID);
  assert.equal((await publishBundle(later, memory)).created, 2);
  assert.deepEqual(await readPublishedRegister(earlier, memory.read), source);
  assert.deepEqual(await readPublishedRegister(later, memory.read), revised);
  revised.sources[0].finding = "🌱".repeat(1001);
  assert.throws(() => makeBundle(revised), /4,000-byte/);
});

test("read and create use the fixed preview endpoint and a conditional first revision", async () => {
  const calls = [];
  const transport = handoffTransport("a".repeat(64), async (url, init) => {
    assert.equal(url, "https://pocket-ai-lab-preview.macksteward59.workers.dev/mcp");
    assert.equal(init.redirect, "error");
    const { params } = JSON.parse(init.body);
    calls.push(params);
    return Response.json({ jsonrpc: "2.0", id: 1, result: { structuredContent: { found: false } } });
  });
  const { index } = makeBundle();
  await transport.read(index.attemptID);
  await transport.create(index);
  assert.deepEqual(calls[0], { name: "document_handoff_read", arguments: { attemptID: index.attemptID } });
  assert.deepEqual(calls[1], { name: "document_handoff_save", arguments: { ...index, expectedRevision: 0 } });
  const failed = handoffTransport("a".repeat(64), async () => Response.json({jsonrpc:"2.0", id:1, result:{isError:true}}));
  await assert.rejects(failed.read(index.attemptID), /did not confirm/);
});

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { registerRevision } from "../../apps/web/project-sources.mjs";

const canonicalFile = new URL("../../docs/research/project-sources.json", import.meta.url);

function noteFor(data) {
  const text = JSON.stringify(data);
  if (Buffer.byteLength(text) > 4000) throw Error("Register exceeds the 4,000-byte handoff note limit");
  const digest = createHash("sha256").update("pocket-ai-lab/source-handoff/v1\0").update(text).digest();
  digest[6] = (digest[6] & 15) | 128;
  digest[8] = (digest[8] & 63) | 128;
  const h = digest.toString("hex", 0, 16);
  return { attemptID: [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join("-"), text };
}

export function makeBundle(register = JSON.parse(readFileSync(canonicalFile)), revision = registerRevision) {
  const { sources, decisions = [], ...metadata } = register;
  const entries = [], records = [], ids = new Set();
  for (const [kind, items] of [["source", sources], ["decision", decisions]]) {
    for (const record of items) {
      if (!record.id || ids.has(record.id)) throw Error("Missing or duplicate register ID");
      ids.add(record.id);
      const note = noteFor({ kind, record });
      records.push(note);
      entries.push({ id: record.id, title: record.title, topics: record.topics, note: note.attemptID });
    }
  }
  const index = noteFor({ format: "pocket-source-register-v1", revision, metadata, entries });
  return { index, records };
}

function verify(note, stored) {
  if (stored?.found !== true || stored.attemptID !== note.attemptID || !Number.isSafeInteger(stored.revision) ||
      stored.revision < 1 || stored.text !== note.text) {
    throw Error("Missing or mismatched published source note " + note.attemptID);
  }
  return JSON.parse(stored.text);
}

export async function publishBundle(bundle, transport) {
  let created = 0;
  for (const note of [...bundle.records, bundle.index]) {
    const prior = await transport.read(note.attemptID);
    if (prior?.found === false && prior.attemptID === note.attemptID && prior.revision === 0) {
      verify(note, await transport.create(note));
      verify(note, await transport.read(note.attemptID));
      created++;
    } else {
      verify(note, prior);
    }
  }
  return { indexID: bundle.index.attemptID, created };
}

export async function readPublishedRegister(bundle, read) {
  const manifest = verify(bundle.index, await read(bundle.index.attemptID));
  const register = { ...manifest.metadata, sources: [], decisions: [] };
  for (const note of bundle.records) {
    const { kind, record } = verify(note, await read(note.attemptID));
    register[kind === "source" ? "sources" : "decisions"].push(record);
  }
  return register;
}

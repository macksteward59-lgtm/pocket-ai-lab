import { asset, digest, modelRecord, openCatalog, savedReaders } from "../model-workshop/catalog.js";
import { hostModel, hostRequest } from "../model-workshop/host.js";
import { snapshotReader, verifyReader } from "../model-workshop/identity.js";
import { readPassage } from "../model-workshop/reader.js";

const SHA = /^[0-9a-f]{64}$/;
const BUILD = /^build-[0-9a-f]{64}$/;
const HOST = /^(?:import|candidate)-[0-9a-f]{64}$/;
const encoder = new TextEncoder();

// A saved chat stores a reference, never a closure, model weights, or a provider setting.
export function readerReference(reader) {
  if (reader == null) return null;
  const location = reader.location === undefined ? "browser" : reader.location;
  if (typeof reader.id !== "string" || typeof reader.hash !== "string" || !SHA.test(reader.hash) ||
      typeof reader.name !== "string" || !reader.name.trim() ||
      (location !== "browser" && location !== "host") ||
      (location === "browser" ? reader.id !== reader.hash && !BUILD.test(reader.id) : !HOST.test(reader.id))) {
    throw Error("The saved model reference has an invalid identity, weight hash, location, or name.");
  }
  return { id: reader.id, hash: reader.hash, location, name: reader.name };
}

async function browserRecords() {
  const bundled = await Promise.all([
    asset("hard").then(weights => modelRecord(weights, "Hard-label reader")),
    asset("soft").then(weights => modelRecord(weights, "Soft-label reader")),
  ]);
  const db = await openCatalog();
  try { return [...bundled, ...await savedReaders(db)]; }
  finally { db.close(); }
}

function matches(records, reference) {
  if (!Array.isArray(records)) throw Error("The model catalog is unavailable.");
  const found = records.filter(record => record?.id === reference.id);
  if (!found.length) throw Error("This chat's exact saved model is unavailable. Restore it or explicitly choose another model.");
  return found;
}

async function exactHost(reference, hostCatalog) {
  const catalog = await hostCatalog();
  const found = matches(catalog?.models, reference).map(hostModel);
  for (const record of found) {
    const current = readerReference(record);
    if (current.hash !== reference.hash) throw Error("This chat's saved host model has changed weights. Select the intended model explicitly.");
  }
  // Match the workshop's last-record display behavior without allowing a conflicting hash to be hidden.
  return structuredClone(found.at(-1));
}

// Resolver injection keeps identity checks testable without substituting a different inference path in production.
export async function restoreReader(reference, resolvers = {}) {
  const ref = readerReference(reference);
  if (ref === null) return null;
  const getBrowserRecords = resolvers.browserRecords ?? browserRecords;
  const getHostCatalog = resolvers.hostCatalog ?? (() => hostRequest());
  const answerOnHost = resolvers.hostAnswer ?? (input => hostRequest(input));

  if (ref.location === "host") {
    const record = await exactHost(ref, getHostCatalog);
    return {
      ...ref, name: record.name, label: record.name + " · " + ref.hash.slice(0, 8),
      ...(record.parents ? { parents: structuredClone(record.parents) } : {}),
      async answer(question) {
        // A host catalog may change while the conversation is open; never send to a replacement.
        await exactHost(ref, getHostCatalog);
        const result = await answerOnHost({ op: "answer", model: ref.id, question });
        if (result?.model !== ref.id || typeof result.answer !== "string" || !result.answer.trim()) {
          throw Error("The training host did not return an answer from the selected model.");
        }
        const sourceHash = await digest(encoder.encode(question.trim()));
        return { question, answer: result.answer, sourceHash };
      },
    };
  }

  const records = matches(await getBrowserRecords(), ref).map(record => structuredClone(record));
  let verified;
  for (const record of records) {
    verified = snapshotReader(new Map([[record.id, record]]), ref.id, ref.hash);
    await verifyReader(verified);
  }
  const record = records.at(-1);
  // readWeights (inside snapshotReader) copies the values captured by this answer closure.
  const weights = verified.weights;
  return {
    ...ref, name: record.name, label: record.name + " · " + ref.hash.slice(0, 8),
    ...(record.run ? { run: structuredClone(record.run) } : {}),
    importedFamily: record.importedFamily === true,
    async answer(question, passage) {
      const result = readPassage(weights, question, passage);
      const sourceHash = await digest(encoder.encode(JSON.stringify(result.sentences)));
      return { question: result.question, answer: result.answer, index: result.index, sourceHash };
    },
  };
}

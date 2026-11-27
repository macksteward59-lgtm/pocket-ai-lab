import { createHash } from "node:crypto";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
export function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
  }
  throw Error("Only JSON strings, booleans, safe integers, arrays and records are allowed in source data.");
}

function check(ok, message) { if (!ok) throw Error(message); }
function text(value, name, max = 1000) {
  check(typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max &&
    !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(value) && !/[\ud800-\udfff]/u.test(value), "Invalid " + name);
}
function array(value, name, low, high) {
  check(Array.isArray(value) && value.length >= low && value.length <= high, "Invalid " + name);
}
function id(value, name) { text(value, name, 100); check(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value), "Invalid " + name); }
function fields(value, required, label) {
  check(value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === required.length && required.every(k => Object.hasOwn(value, k)), "Invalid fields in " + label);
}

export function validateCorpus(corpus, suite) {
  fields(corpus, ["schema", "created_date", "evaluation_kind", "training_sources", "primary_bytes_pinned", "notes", "sources"], "corpus");
  fields(suite, ["schema", "evaluation_kind", "scoring", "cases"], "case suite");
  check(corpus.schema === "pocket-source-pilot-corpus-v1" && suite.schema === "pocket-source-pilot-cases-v1", "Unsupported source or case schema");
  check(corpus.evaluation_kind === "visible-development-fixture" && suite.evaluation_kind === corpus.evaluation_kind, "Evaluation scope mismatch");
  check(corpus.primary_bytes_pinned === false, "This pilot does not pin primary source bytes");
  text(corpus.created_date, "date", 10); text(corpus.notes, "corpus notes", 1000); text(suite.scoring, "scoring description", 1000);
  array(corpus.sources, "source list", 1, 32); array(corpus.training_sources, "training sources", 0, 64);
  array(suite.cases, "case list", 1, 64);
  const byId = new Map(), families = new Map(), noteIds = new Set(), caseIds = new Set(), trainingIds = new Set();
  function familySplit(family, split) {
    if (families.has(family)) check(families.get(family) === split, "Source-family split leakage: " + family);
    families.set(family, split);
  }
  for (const train of corpus.training_sources) {
    fields(train, ["id", "family", "split"], "training source");
    id(train.id, "training id"); id(train.family, "training family");
    check(!trainingIds.has(train.id), "Duplicate training source id"); trainingIds.add(train.id);
    check(train.split === "training", "Invalid training split"); familySplit(train.family, train.split);
  }
  for (const source of corpus.sources) {
    fields(source, ["id", "family", "split", "title", "authors", "version", "url", "related_urls", "text_kind", "rights", "notes"], "source card");
    id(source.id, "source id"); id(source.family, "source family");
    check(!byId.has(source.id), "Duplicate source id");
    check(!trainingIds.has(source.id), "Source ID appears in training and evaluation");
    check(source.split === "evaluation", "Only evaluation cards belong in this pilot");
    familySplit(source.family, source.split);
    text(source.title, "source title"); text(source.version, "source version"); text(source.rights, "source rights", 1000);
    array(source.authors, "authors", 1, 30); source.authors.forEach(x => text(x, "author", 160));
    text(source.url, "source URL", 1500); array(source.related_urls, "related URLs", 0, 20);
    for (const url of [source.url, ...source.related_urls]) {
      text(url, "URL", 1500);
      check(url.startsWith("https://") || (source.text_kind === "owned_synthetic" && url.startsWith("urn:pocket:fixture:")), "Unsupported citation URL");
      if (url.startsWith("https://")) {
        const parsed = new URL(url); check(parsed.hostname && !parsed.username && !parsed.password, "Invalid citation URL");
      }
    }
    check(["curated_paraphrase", "owned_synthetic"].includes(source.text_kind), "Unknown source text kind");
    array(source.notes, "source notes", 1, 64);
    for (const note of source.notes) {
      fields(note, ["id", "text", "locator", "provenance", "claim_type", "limitation"], "source note");
      id(note.id, "note id"); check(!noteIds.has(note.id), "Duplicate note id"); noteIds.add(note.id);
      text(note.text, "note text", 6000); text(note.locator, "note locator", 1500);
      text(note.claim_type, "claim type", 150); text(note.limitation, "limitation", 1000);
      check(note.provenance === (source.text_kind === "owned_synthetic" ? "owned_synthetic" : "source_reported"), "Note provenance mismatch");
    }
    check(source.notes.map(x => x.text).join("\n").length <= 6000, "Source exceeds workshop passage limit");
    byId.set(source.id, source);
  }
  for (const item of suite.cases) {
    fields(item, ["id", "source_id", "question", "kind", "expected_note_id", "label_provenance"], "case");
    id(item.id, "case id"); check(!caseIds.has(item.id), "Duplicate case id"); caseIds.add(item.id);
    text(item.question, "question", 500); text(item.label_provenance, "label provenance", 500);
    const source = byId.get(item.source_id); check(source, "Unknown case source");
    check(["supported", "unsupported", "contradiction", "untrusted_instruction"].includes(item.kind), "Unknown case kind");
    if (item.kind === "supported") check(source.notes.some(n => n.id === item.expected_note_id), "Supported case needs a note from its own source");
    else check(item.expected_note_id === null, "Abstention case must not carry an answer label");
  }
  for (const id of byId.keys()) check(suite.cases.some(x => x.source_id === id), "Source has no cases");
  check(Buffer.byteLength(canonical(corpus)) <= 128 * 1024 && Buffer.byteLength(canonical(suite)) <= 128 * 1024, "Corpus is too large");
  return { byId, families };
}

export function toWorkshop(corpus, suite) {
  validateCorpus(corpus, suite);
  return corpus.sources.map(source => ({
    id: source.id, url: source.url, sentences: source.notes.map(n => n.text),
    questions: suite.cases.filter(c => c.source_id === source.id).map(c =>
      [c.question, c.expected_note_id === null ? -1 : source.notes.findIndex(n => n.id === c.expected_note_id)]),
  }));
}

export function citationFor(source, note) {
  return { source_id: source.id, source_family: source.family, version: source.version,
    url: source.url, text_kind: source.text_kind, note_id: note.id, locator: note.locator,
    note_sha256: sha256(note.text), source_record_sha256: sha256(canonical(source)) };
}

export function summarize(rows, modelKeys) {
  const metrics = {};
  for (const key of modelKeys) {
    const result = { supported: { correct: 0, total: 0, wrong_selection: 0, abstained: 0 },
      abstention: { correct: 0, total: 0, answered: 0 }, citation_integrity: { valid: 0, total: 0 } };
    for (const row of rows) {
      const output = row.outputs.find(x => x.model_key === key);
      if (!output) throw Error("Missing model output");
      if (row.kind === "supported") {
        result.supported.total++;
        if (output.selected_note_id === row.expected_note_id) result.supported.correct++;
        else if (output.selected_note_id === null) result.supported.abstained++;
        else result.supported.wrong_selection++;
      } else {
        result.abstention.total++;
        if (output.selected_note_id === null) result.abstention.correct++; else result.abstention.answered++;
      }
      if (output.selected_note_id !== null) {
        result.citation_integrity.total++;
        if (output.citation_binding_valid === true) result.citation_integrity.valid++;
      }
    }
    metrics[key] = result;
  }
  return metrics;
}

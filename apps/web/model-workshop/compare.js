import { modelRecord, sources } from "./catalog.js";
import { editBuildId } from "./edit.js";
import { trainingBuildId } from "./family.js";
import { readPassage, readWeights, recipe as trainingRecipe } from "./reader.js";

export const MAX_COMPARISON_BYTES = 128 * 1024;
const SHA = /^[0-9a-f]{64}$/;
const BUILD_ID = /^build-[0-9a-f]{64}$/;

function validateDocuments(documents) {
  if (!Array.isArray(documents) || !documents.length || documents.length > 64) {
    throw Error("Use 1–64 documents with at most 64 questions in total.");
  }
  const cases = [];
  for (const doc of documents) {
    if (!doc || typeof doc !== "object" || Array.isArray(doc) ||
        Object.keys(doc).some(key => !["sentences", "questions", "id", "url"].includes(key)) ||
        (Object.hasOwn(doc, "id") && typeof doc.id !== "string") ||
        (Object.hasOwn(doc, "url") && typeof doc.url !== "string")) {
      throw Error("A document needs sentences and questions. Optional id and url fields must be text.");
    }
    if (!Array.isArray(doc.sentences) || doc.sentences.length < 1 || doc.sentences.length > 64) {
      throw Error("Use 1–64 sentences in each document.");
    }
    for (const s of doc.sentences) {
      if (typeof s !== "string" || !s.trim() || /[\r\n\u2028\u2029]/.test(s)) {
        throw Error("Each source sentence must be one nonblank line.");
      }
    }
    const passage = doc.sentences.join("\n");
    if (passage.length > 6000) throw Error("Each passage must fit within 6,000 characters.");
    if (!Array.isArray(doc.questions) || doc.questions.length < 1 || cases.length + doc.questions.length > 64) {
      throw Error("Include at least one question per document and at most 64 questions in total.");
    }
    for (const pair of doc.questions) {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" ||
          !pair[0].trim() || pair[0].length > 500) {
        throw Error("Use a question of up to 500 characters paired with its expected answer.");
      }
      const [rawQuestion, expected] = pair;
      if (expected !== null && (!Number.isInteger(expected) || expected < -1 || expected >= doc.sentences.length)) {
        throw Error("The expected answer must be a valid sentence index, -1 for missing evidence, or null for ungraded.");
      }
      cases.push({ question: rawQuestion, passage, expected });
    }
  }
  const json = JSON.stringify(documents);
  if (json.length > MAX_COMPARISON_BYTES || new TextEncoder().encode(json).length > MAX_COMPARISON_BYTES) {
    throw Error("The comparison file must fit within 128 KiB.");
  }
  return cases;
}

// Snapshot exactly the lineage fields that identify this build. No ancestor execution or replay is needed.
function lineage(run) {
  if (!run) return null;
  function reference(parent) {
    if (!parent || typeof parent.id !== "string" || !parent.id ||
        typeof parent.hash !== "string" || !SHA.test(parent.hash) ||
        (!BUILD_ID.test(parent.id) && parent.id !== parent.hash)) {
      throw Error("Missing or invalid parent identity or weight hash.");
    }
    return { id: parent.id, hash: parent.hash };
  }
  const base = reference(run.base);
  if (typeof run.evaluation !== "string" || !SHA.test(run.evaluation)) throw Error("Missing evaluation identity.");
  const saved = { recipe: run.recipe, evaluation: run.evaluation, base };
  if (run.recipe === trainingRecipe && run.teacher && !run.second &&
      run.training === sources.training && run.evaluation === sources.evaluation) {
    return { ...saved, teacher: reference(run.teacher) };
  }
  if (run.recipe === "reader-linear-blend-v1" && run.second && !run.teacher &&
      Number.isInteger(run.rightPercent) && run.rightPercent >= 1 && run.rightPercent <= 99) {
    return { ...saved, second: reference(run.second), rightPercent: run.rightPercent };
  }
  if (run.recipe === "reader-parameter-edit-v1" && !run.teacher && !run.second) return saved;
  throw Error("This reader has an unsupported or incomplete build recipe.");
}

function comparisonModels(rootId, catalog) {
  const models = [], seen = new Set();
  function add(id, role, parent) {
    const record = catalog.get(id);
    if (!record || typeof id !== "string" || !id || record.id !== id || typeof record.name !== "string" ||
        !record.name.trim() || typeof record.hash !== "string" || !SHA.test(record.hash) ||
        (parent && parent.hash !== record.hash)) {
      throw Error("The selected reader or a recorded parent is missing or has a different identity or weight hash.");
    }
    if (record.run ? !BUILD_ID.test(id) : id !== record.hash) {
      throw Error("The reader identity does not match a catalog build or a plain reader's weight hash.");
    }
    if (seen.has(id)) throw Error("The selected reader needs distinct parent identities.");
    seen.add(id);
    const weights = readWeights(record.weights);
    const values = [...weights.weights.flat(), ...weights.biases, ...weights.output, weights.intercept];
    if (values.length !== 97 || !values.every(Number.isFinite)) throw Error("Each reader needs all 97 finite weights.");
    const model = { id, name: record.name, hash: record.hash, run: lineage(record.run), weights, role };
    models.push(model);
    return model;
  }
  const selected = add(rootId, "Selected reader");
  if (!selected.run) return models;
  const { base, teacher, second } = selected.run;
  add(base.id, "Base", base);
  if (teacher) add(teacher.id, "Teacher", teacher);
  if (second) add(second.id, "Second parent", second);
  return models;
}

export async function compareReaders(rootId, catalog, documents) {
  const questions = validateDocuments(documents);
  const selected = comparisonModels(rootId, catalog);
  // All selected IDs, names, weights and input strings are captured before yielding to WebCrypto.
  await Promise.all(selected.map(async ({ id, weights, name, hash, run }) => {
    if ((await modelRecord(weights, name)).hash !== hash) {
      throw Error("The selected reader or a parent has different weights from its recorded hash.");
    }
    if (run) {
      const expected = run.teacher ? await trainingBuildId(run.base.id, run.teacher.id, hash) : await editBuildId(run, hash);
      if (id !== expected) throw Error("The reader's build identity differs from its recorded parents and recipe.");
    }
  }));
  const models = selected.map(({ id, name, role }) => ({ id, name, role, correct: 0, total: 0 }));
  const cases = questions.map(({ question, passage, expected }) => ({ question, passage, expected, results: [] }));
  const predictions = new Map();
  for (const [i, { weights }] of selected.entries()) {
    // Multiple distinct builds may share weights. Reuse their predictions, retaining each role and identity.
    const key = JSON.stringify(weights);
    let answers = predictions.get(key);
    if (!answers) {
      answers = questions.map(({ question, passage }) => readPassage(weights, question, passage));
      predictions.set(key, answers);
    }
    for (const [j, answer] of answers.entries()) {
      const item = cases[j];
      item.sentences = answer.sentences;
      item.results.push({ id: models[i].id, index: answer.index, answer: answer.answer });
      if (item.expected !== null) {
        models[i].total++;
        if (item.expected === answer.index) models[i].correct++;
      }
    }
  }
  return { models, cases };
}

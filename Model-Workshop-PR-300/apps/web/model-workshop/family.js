import { digest, modelRecord, sources } from "./catalog.js";
import { reviewEdit } from "./edit.js";
import { evaluate, readWeights, recipe as trainingRecipe, verifiedTeacherPairs } from "./reader.js";

export const FAMILY_MAX_BYTES = 512 * 1024;
export const FAMILY_MAX_READERS = 64;
const FORMAT = "pocket-reader-family-v1";
const EDIT = "reader-parameter-edit-v1";
const BLEND = "reader-linear-blend-v1";
const encoder = new TextEncoder();
const hashText = text => digest(encoder.encode(text));

export function trainingBuildId(baseId, teacherId, weightHash) {
  const key = [trainingRecipe, baseId, teacherId, sources.training, sources.evaluation, weightHash];
  return hashText(JSON.stringify(key)).then(hash => "build-" + hash);
}

function fields(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw Error("The reader family contains missing or unsupported fields.");
  }
}

function readerId(id) {
  if (typeof id !== "string" || !/^(?:build-)?[0-9a-f]{64}$/.test(id)) {
    throw Error("Invalid reader identity in the family.");
  }
  return id;
}

function readerName(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 64 ||
      /[\u0000-\u001f\u007f-\u009f]/.test(value)) throw Error("Invalid reader name in the family.");
  return value.trim();
}

function exportName(value) {
  if (typeof value !== "string") return "Unnamed reader";
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").trim().slice(0, 64).trim() || "Unnamed reader";
}

function parentRoles(run) {
  if (run === undefined) return [];
  const common = ["recipe", "base", "evaluation", "scores"];
  switch (run?.recipe) {
    case trainingRecipe:
      fields(run, [...common, "teacher", "training", "verifiedPairs"]);
      return ["base", "teacher"];
    case BLEND:
      fields(run, [...common, "second", "rightPercent", "editedParameters"]);
      return ["base", "second"];
    case EDIT:
      fields(run, [...common, "editedParameters"]);
      return ["base"];
    default: throw Error("Unsupported reader family recipe.");
  }
}

function ancestry(root, catalog) {
  const seen = new Set(), active = new Set(), ordered = [];
  function visit(id) {
    readerId(id);
    if (active.has(id)) throw Error("The reader family contains a parent cycle.");
    if (seen.has(id)) return;
    if (seen.size >= FAMILY_MAX_READERS) throw Error("A family can contain up to 64 readers.");
    const row = catalog.get(id);
    if (!row || row.id !== id) throw Error("A parent or root is missing from the reader family.");
    active.add(id);
    seen.add(id);
    for (const role of parentRoles(row.run)) {
      const ref = row.run[role];
      fields(ref, ["id", "hash", "label"]);
      if (typeof ref.label !== "string") throw Error("Invalid parent label.");
      visit(ref.id);
      if (catalog.get(ref.id).hash !== ref.hash) throw Error("A parent weight hash differs from its family record.");
    }
    active.delete(id);
    ordered.push(row);
  }
  visit(root);
  return ordered;
}

// Snapshot before any asynchronous hashing and cap the compact wire representation in UTF-8 bytes.
function boundedCopy(value) {
  const text = JSON.stringify(value);
  if (typeof text !== "string") throw Error("Choose a reader family JSON file.");
  if (text.length > FAMILY_MAX_BYTES || encoder.encode(text).length > FAMILY_MAX_BYTES) {
    throw Error("Reader families must fit within 512 KiB.");
  }
  return JSON.parse(text);
}

function ref(parent) {
  return { id: parent.id, hash: parent.hash, label: parent.name + " · " + parent.hash.slice(0, 8) };
}

function checkedScore(score) {
  fields(score, ["correct", "total"]);
  if (!Number.isSafeInteger(score.correct) || !Number.isSafeInteger(score.total) ||
      score.correct < 0 || score.total < 1 || score.correct > score.total) throw Error("Invalid held-out score.");
  return { correct: score.correct, total: score.total };
}

function exportRun(run, catalog) {
  const roles = parentRoles(run);
  const scoreRoles = [...roles, "candidate"];
  fields(run.scores, scoreRoles);
  const scores = {};
  for (const role of scoreRoles) {
    scores[role] = checkedScore(run.scores[role]);
  }
  if (run.evaluation !== sources.evaluation) throw Error("The family references an unknown evaluation.");
  const result = { recipe: run.recipe };
  for (const role of roles) {
    const parent = catalog.get(run[role].id);
    result[role] = ref({ id: parent.id, hash: parent.hash, name: exportName(parent.name) });
  }
  if (run.recipe === trainingRecipe) {
    if (run.training !== sources.training || !Number.isSafeInteger(run.verifiedPairs) || run.verifiedPairs < 0) {
      throw Error("Invalid training record.");
    }
    result.training = sources.training;
    result.verifiedPairs = run.verifiedPairs;
  } else {
    if (!Number.isInteger(run.editedParameters) || run.editedParameters < 0 || run.editedParameters > 97) {
      throw Error("Invalid edited-parameter count.");
    }
    if (run.recipe === BLEND) {
      if (!Number.isInteger(run.rightPercent) || run.rightPercent < 1 || run.rightPercent > 99) {
        throw Error("Invalid blend percentage.");
      }
      result.rightPercent = run.rightPercent;
    }
    result.editedParameters = run.editedParameters;
  }
  return { ...result, evaluation: sources.evaluation, scores };
}

export function exportFamily(rootId, catalog) {
  const readers = ancestry(rootId, catalog).map(entry => {
    if (typeof entry.hash !== "string" || !/^[0-9a-f]{64}$/.test(entry.hash)) {
      throw Error("Invalid reader weight hash.");
    }
    const row = { id: entry.id, name: exportName(entry.name), weights: readWeights(entry.weights), hash: entry.hash };
    if (entry.run) row.run = exportRun(entry.run, catalog);
    return row;
  });
  return boundedCopy({ format: FORMAT, root: rootId, readers });
}

async function pinnedCorpus(documents, hash) {
  const text = JSON.stringify(documents, null, 2) + "\n";
  if (await hashText(text) !== hash) throw Error("The local verification corpus differs from its pinned version.");
  return JSON.parse(text);
}

function recordDifference(differences, id, field, reported, local) {
  if (reported !== local) differences.push({ id, field, reported, local });
}

function compareScores(id, claims, actual, differences) {
  fields(claims, Object.keys(actual));
  for (const [role, score] of Object.entries(actual)) {
    const claim = checkedScore(claims[role]);
    if (claim.total !== score.total) throw Error("The held-out score total differs from the pinned evaluation.");
    recordDifference(differences, id, "scores." + role + ".correct", claim.correct, score.correct);
  }
}

async function inspectTrained(candidate, run, base, teacher, training, evaluation, differences) {
  if (run.training !== sources.training || run.evaluation !== sources.evaluation) {
    throw Error("The training recipe must reference the pinned workshop corpora.");
  }
  if (new Set([base.hash, teacher.hash, candidate.hash]).size !== 3) {
    throw Error("A trained candidate must have two distinct parents and distinct candidate weights.");
  }
  const maximum = training.reduce((count, doc) => count + doc.questions.length * doc.sentences.length, 0);
  if (!Number.isSafeInteger(run.verifiedPairs) || run.verifiedPairs < 0 || run.verifiedPairs > maximum) {
    throw Error("Invalid verified teacher example count for the pinned corpus.");
  }
  const verifiedPairs = verifiedTeacherPairs(teacher.weights, training).pairs.length;
  const id = await trainingBuildId(base.id, teacher.id, candidate.hash);
  recordDifference(differences, id, "verifiedPairs", run.verifiedPairs, verifiedPairs);
  const scores = {
    base: evaluate(base.weights, evaluation), teacher: evaluate(teacher.weights, evaluation),
    candidate: evaluate(candidate.weights, evaluation),
  };
  // Preserve the producer's actual weights. This verifies the manifest and observable scores,
  // not the identity of the producer or a byte-for-byte replay of training across math engines.
  return {
    ...candidate, id,
    run: { recipe: trainingRecipe, base: ref(base), teacher: ref(teacher), training: sources.training,
      evaluation: sources.evaluation, verifiedPairs, scores },
  };
}

export async function inspectFamily(bundle, { training, evaluation } = {}) {
  const input = boundedCopy(bundle);
  fields(input, ["format", "root", "readers"]);
  if (input.format !== FORMAT || !Array.isArray(input.readers) || !input.readers.length ||
      input.readers.length > FAMILY_MAX_READERS) throw Error("Choose a v1 reader family with 1–64 readers.");
  const raw = new Map();
  for (const row of input.readers) {
    fields(row, ["id", "name", "weights", "hash"], ["run"]);
    readerId(row.id);
    if (raw.has(row.id)) throw Error("Duplicate reader identity in family.");
    raw.set(row.id, row);
  }
  const ordered = ancestry(input.root, raw);
  if (ordered.length !== raw.size) throw Error("The family contains readers unrelated to the selected root.");
  const [heldOut, teacherData] = await Promise.all([
    ordered.some(row => row.run) ? pinnedCorpus(evaluation, sources.evaluation) : null,
    ordered.some(row => row.run?.recipe === trainingRecipe) ? pinnedCorpus(training, sources.training) : null,
  ]);
  const checked = new Map(), differences = [];
  for (const { id, name, weights, hash, run } of ordered) {
    fields(weights, ["version", "features", "weights", "biases", "output", "intercept"]);
    let candidate = await modelRecord(weights, readerName(name));
    if (hash !== candidate.hash) throw Error("Reader weights do not match their recorded hash.");
    if (run?.recipe === trainingRecipe) {
      candidate = await inspectTrained(candidate, run, checked.get(run.base.id), checked.get(run.teacher.id),
        teacherData, heldOut, differences);
    } else if (run) {
      candidate = await reviewEdit({
        base: checked.get(run.base.id), second: run.second && checked.get(run.second.id),
        rightPercent: run.rightPercent, weights: candidate.weights, name: candidate.name,
        evaluation: heldOut, evaluationHash: run.evaluation,
      });
      if (candidate.run.editedParameters !== run.editedParameters) throw Error("The edited-parameter count differs.");
    }
    if (candidate.id !== id) throw Error("The reader identity does not match its weights and build history.");
    if (run) compareScores(id, run.scores, candidate.run.scores, differences);
    checked.set(id, candidate);
  }
  return { root: input.root, records: [...checked.values()], differences };
}

import { digest, modelRecord } from "./catalog.js";
import { evaluate, readWeights } from "./reader.js";

const encoder = new TextEncoder();
const sha256 = text => digest(encoder.encode(text));

function parameters(model) {
  return [...model.weights.flat(), ...model.biases, ...model.output, model.intercept];
}

function compatibleWeights(raw) {
  const weights = readWeights(raw);
  // Arrays from JSON are dense. Also reject holes when called directly with a JavaScript array.
  const values = parameters(weights);
  if (values.length !== 97 || !values.every(Number.isFinite)) {
    throw Error("A v1 document reader needs all 97 finite parameters.");
  }
  return weights;
}

function editsBetween(left, right) {
  const other = parameters(right);
  return parameters(left).reduce((sum, value, i) => sum + Number(value !== other[i]), 0);
}

export function blendReaders(left, right, rightPercent) {
  if (!Number.isInteger(rightPercent) || rightPercent < 1 || rightPercent > 99) {
    throw Error("Choose a whole second-parent percentage from 1 through 99.");
  }
  const base = compatibleWeights(left), second = compatibleWeights(right);
  if (!editsBetween(base, second)) throw Error("Choose two readers with different weights.");
  // This formula preserves identical parameters exactly, including at extreme magnitudes.
  const blend = (a, b) => a === b ? a : (a * (100 - rightPercent) + b * rightPercent) / 100;
  const combine = (a, b) => a.map((value, i) => blend(value, b[i]));
  return compatibleWeights({
    version: base.version, features: base.features,
    weights: base.weights.map((row, i) => combine(row, second.weights[i])),
    biases: combine(base.biases, second.biases), output: combine(base.output, second.output),
    intercept: blend(base.intercept, second.intercept),
  });
}

// Display names are not identity. Equal weights from differently derived parents retain their own lineage.
export async function editBuildId(run, weightHash) {
  const key = [run.recipe, run.base.id, run.base.hash, run.second?.id ?? null, run.second?.hash ?? null,
    run.second ? run.rightPercent : null, run.evaluation, weightHash];
  return "build-" + await sha256(JSON.stringify(key));
}

async function readParent(entry) {
  if (typeof entry?.id !== "string" || !entry.id.trim() || typeof entry.name !== "string" || !entry.name.trim()) {
    throw Error("Choose a saved reader with a model identity and name.");
  }
  const { id, hash, name } = entry;
  const weights = compatibleWeights(entry.weights);
  const actual = await modelRecord(weights, name);
  if (hash !== actual.hash) throw Error("The selected parent’s recorded hash differs from its weights.");
  return { weights, ref: { id, hash, label: name + " · " + hash.slice(0, 8) } };
}

function evaluationText(documents) {
  if (!Array.isArray(documents) || !documents.length) throw Error("Choose a nonempty held-out evaluation set.");
  const text = value => typeof value === "string" && value.trim().length > 0;
  for (const doc of documents) {
    if (!Array.isArray(doc?.sentences) || !doc.sentences.length || !Array.from(doc.sentences).every(text) ||
        !Array.isArray(doc.questions) || !doc.questions.length) throw Error("Invalid held-out document.");
    for (const pair of doc.questions) {
      if (!Array.isArray(pair) || pair.length !== 2 || !text(pair[0]) ||
          !Number.isInteger(pair[1]) || pair[1] < -1 || pair[1] >= doc.sentences.length) {
        throw Error("Invalid question or expected sentence in the held-out evaluation.");
      }
    }
  }
  // Match the versioned corpus files with two-space indentation and a final newline.
  return JSON.stringify(documents, null, 2) + "\n";
}

export async function reviewEdit({ base, second, rightPercent, weights, name, evaluation, evaluationHash }) {
  const hasSecond = second != null;
  if (!hasSecond && rightPercent != null) throw Error("Choose a second parent to use a blend percentage.");
  if (hasSecond && second.id === base?.id) throw Error("Choose two distinct parent identities.");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 64) {
    throw Error("Give the candidate a name of up to 64 characters.");
  }
  const corpusText = evaluationText(evaluation);
  const finalWeights = compatibleWeights(weights);
  const [left, right, corpusHash, candidate] = await Promise.all([
    readParent(base), hasSecond ? readParent(second) : null, sha256(corpusText), modelRecord(finalWeights, name.trim()),
  ]);
  if (evaluationHash !== corpusHash) throw Error("The held-out evaluation differs from its recorded hash.");
  const initial = right ? blendReaders(left.weights, right.weights, rightPercent) : left.weights;
  const editedParameters = editsBetween(initial, finalWeights);
  if (!editsBetween(left.weights, finalWeights) || (right && !editsBetween(right.weights, finalWeights))) {
    throw Error(right ? "The candidate matches a parent. Change a parameter or the blend percentage."
      : "The candidate matches its base. Change at least one parameter before reviewing.");
  }
  const documents = JSON.parse(corpusText);
  const scores = { base: evaluate(left.weights, documents) };
  if (right) scores.second = evaluate(right.weights, documents);
  scores.candidate = evaluate(finalWeights, documents);
  const run = {
    recipe: right ? "reader-linear-blend-v1" : "reader-parameter-edit-v1", base: left.ref,
    ...(right ? { second: right.ref, rightPercent } : {}),
    editedParameters, evaluation: corpusHash, scores,
  };
  return { ...candidate, id: await editBuildId(run, candidate.hash), run };
}

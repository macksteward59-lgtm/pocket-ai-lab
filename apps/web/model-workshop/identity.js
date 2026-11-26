import { modelRecord, sources } from "./catalog.js";
import { editBuildId } from "./edit.js";
import { trainingBuildId } from "./family.js";
import { readWeights, recipe as trainingRecipe } from "./reader.js";

const SHA = /^[0-9a-f]{64}$/;
const BUILD_ID = /^build-[0-9a-f]{64}$/;

export function readerReference(parent) {
  if (!parent || typeof parent.id !== "string" || !parent.id ||
      typeof parent.hash !== "string" || !SHA.test(parent.hash) ||
      (!BUILD_ID.test(parent.id) && parent.id !== parent.hash)) {
    throw Error("Missing or invalid parent identity or weight hash.");
  }
  return { id: parent.id, hash: parent.hash };
}

// Snapshot exactly the lineage fields that identify this build. No ancestor execution or replay is needed.
function lineage(run) {
  if (!run) return null;
  const base = readerReference(run.base);
  if (typeof run.evaluation !== "string" || !SHA.test(run.evaluation)) throw Error("Missing evaluation identity.");
  const saved = { recipe: run.recipe, evaluation: run.evaluation, base };
  if (run.recipe === trainingRecipe && run.teacher && !run.second &&
      run.training === sources.training && run.evaluation === sources.evaluation) {
    return { ...saved, teacher: readerReference(run.teacher) };
  }
  if (run.recipe === "reader-linear-blend-v1" && run.second && !run.teacher &&
      Number.isInteger(run.rightPercent) && run.rightPercent >= 1 && run.rightPercent <= 99) {
    return { ...saved, second: readerReference(run.second), rightPercent: run.rightPercent };
  }
  if (run.recipe === "reader-parameter-edit-v1" && !run.teacher && !run.second) return saved;
  throw Error("This reader has an unsupported or incomplete build recipe.");
}

export function snapshotReader(catalog, id, expectedHash) {
  const record = catalog.get(id);
  if (!record || typeof id !== "string" || !id || record.id !== id || typeof record.name !== "string" ||
      !record.name.trim() || typeof record.hash !== "string" || !SHA.test(record.hash) ||
      (expectedHash !== undefined && expectedHash !== record.hash)) {
    throw Error("The selected reader or a recorded parent is missing or has a different identity or weight hash.");
  }
  if (record.run ? !BUILD_ID.test(id) : id !== record.hash) {
    throw Error("The reader identity does not match a catalog build or a plain reader's weight hash.");
  }
  const weights = readWeights(record.weights);
  const values = [...weights.weights.flat(), ...weights.biases, ...weights.output, weights.intercept];
  if (values.length !== 97 || !values.every(Number.isFinite)) throw Error("Each reader needs all 97 finite weights.");
  return { id, name: record.name, hash: record.hash, run: lineage(record.run), weights };
}

export async function verifyReader({ id, weights, name, hash, run }) {
  if ((await modelRecord(weights, name)).hash !== hash) {
    throw Error("The selected reader or a parent has different weights from its recorded hash.");
  }
  if (run) {
    const expected = run.teacher ? await trainingBuildId(run.base.id, run.teacher.id, hash) : await editBuildId(run, hash);
    if (id !== expected) throw Error("The reader's build identity differs from its recorded parents and recipe.");
  }
}

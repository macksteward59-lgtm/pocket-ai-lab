import { hostRequest, hostModel } from "./host.js";
import { evaluate, readPassage, readWeights, recipe, train } from "./reader.js";
import { asset, digest, exportReader, importReader, insertFamily, insertReader, modelRecord, openCatalog, savedReaders, sources } from "./catalog.js";
import { blendReaders, reviewEdit } from "./edit.js";
import { exportFamily, FAMILY_MAX_BYTES, inspectFamily, trainingBuildId } from "./family.js";

const field = name => document.getElementById("reader-" + name);
const status = field("status"), base = field("base"), teacher = field("teacher"), use = field("use");
const models = new Map(), hostModels = new Map(), hostDrafts = new Map();
const engine = document.getElementById("workshop-engine");
const pause = document.getElementById("host-pause"), resume = document.getElementById("host-resume");
const drafts = document.getElementById("host-drafts"), draftInfo = document.getElementById("host-draft-info");
const hostMode = () => engine.value === "host";
const catalog = () => hostMode() ? hostModels : models;
const method = field("method"), editor = field("editor"), percent = field("percent");
const parameter = field("parameter"), parameterValue = field("value");
const parameterPaths = new Map();
const workshop = document.getElementById("models-view");
const familyFile = field("family-file"), familyPreview = field("family-preview");
let familyDraft, familyGeneration = 0;
let typedValue = false, validDraft = false;
const buildMethod = () => hostMode() ? "train" : method.value;
let editorSeed = null, originalText = "", staleEditor = false;
let db, pending;
let bundledReaders = [];
let initialized = false;
const label = entry => entry.name + " · " + entry.hash.slice(0, 8);

function runOrigin(run, parentName = ref => ref.label) {
  if (run.teacher) return "Built from " + parentName(run.base) + " with " + parentName(run.teacher) + " as teacher.";
  if (run.second) return "Combined " + parentName(run.base) + " (" + (100 - run.rightPercent) + "%) and " +
    parentName(run.second) + " (" + run.rightPercent + "%).";
  return "Edited from " + parentName(run.base) + ".";
}

function updateOrigin() {
  const entry = catalog().get(use.value);
  const fromFamily = entry?.importedFamily && entry.run;
  field("origin").textContent = entry?.run
    ? (fromFamily ? "Imported model family. The file declares the " + entry.run.recipe + " recipe and these parents. " : "") +
      runOrigin(entry.run) + (fromFamily ? " Historical training and authorship are unverified. Locally measured score " : " Held-out score ") +
      entry.run.scores.candidate.correct + "/" + entry.run.scores.candidate.total + "."
    : entry?.location === "host" ? (entry.parents ? "Base " + entry.parents.base + " · Teacher " + entry.parents.teacher : "Host-installed language model.")
    : entry?.origin || (entry ? "Imported document reader." : "");
  field("output").textContent = "";
}
function listReaders() {
  for (const select of [base, teacher, use]) {
    const selected = select.value;
    select.replaceChildren(...Array.from(catalog().values(), record => {
      const build = record.run ? " · build " + record.id.slice(6, 18) : "";
      return new Option(label(record) + build, record.id);
    }));
    if (catalog().has(selected)) select.value = selected;
  }
  updateOrigin();
}
function invalidate() {
  pending = undefined;
  field("save").disabled = true;
  field("edit-summary").hidden = true;
  field("comparison").hidden = true;
  status.textContent = "";
}

function indexParameters(weights) {
  function add(path, name) {
    const key = path.join(".");
    parameterPaths.set(key, path);
    parameter.add(new Option(name, key));
  }
  add(["intercept"], "Output bias (intercept)");
  weights.weights.forEach((row, unit) => {
    const label = "Hidden unit " + (unit + 1);
    add(["biases", unit], label + " · bias");
    add(["output", unit], label + " · output weight");
    weights.features.forEach((feature, featureIndex) => {
      add(["weights", unit, featureIndex], label + " · " + feature.replaceAll("_", " "));
    });
  });
}

function syncParameter() {
  typedValue = false;
  try {
    const weights = readWeights(JSON.parse(editor.value));
    if (!parameterPaths.size) indexParameters(weights);
    const path = parameterPaths.get(parameter.value);
    parameterValue.value = String(path.reduce((value, key) => value[key], weights));
    validDraft = true;
    field("value-status").textContent = "";
  } catch {
    validDraft = false;
    parameterValue.value = "";
    field("value-status").textContent = "Fix the candidate weights in the advanced editor to select a parameter.";
  }
}

function parameterHint() {
  const value = parameterValue.valueAsNumber;
  return Number.isFinite(value) && Math.abs(value) <= 1e6
    ? "Apply the value to your copy before comparing."
    : "Enter a finite number between −1,000,000 and 1,000,000.";
}

function prepareEditor(replaceEdits = false) {
  const kind = buildMethod();
  if (kind === "train") return;
  const left = models.get(base.value), right = kind === "blend" ? models.get(teacher.value) : null;
  const share = percent.valueAsNumber;
  const seed = JSON.stringify([kind, base.value, right?.id, right ? share : null]);
  const hint = field("editor-hint");
  if (kind === "blend" && (!Number.isInteger(share) || share < 1 || share > 99 || !right || right.hash === left?.hash)) {
    staleEditor = true;
    hint.textContent = "Choose distinct parent weights and a whole-number share from 1 to 99%.";
    return;
  }
  if (!left) {
    staleEditor = true;
    hint.textContent = "Choose a base reader.";
    return;
  }
  if (seed !== editorSeed && editor.value !== originalText && !replaceEdits) {
    staleEditor = true;
    hint.textContent = "The selection changed. Load the selected weights to replace your edits, or return to the previous selection.";
    return;
  }
  if (seed !== editorSeed || replaceEdits) {
    const weights = right ? blendReaders(left.weights, right.weights, share) : left.weights;
    originalText = JSON.stringify(weights, null, 2);
    editor.value = originalText;
    editorSeed = seed;
    syncParameter();
  }
  staleEditor = false;
  hint.textContent = right
    ? "Starting weights use " + (100 - share) + "% of the base and " + share + "% of the second reader. You can also edit the values."
    : "Change the parameter values in this copy, then compare it with the base reader.";
}

function showMethod() {
  const kind = buildMethod();
  field("method-group").hidden = hostMode();
  field("teacher-group").hidden = kind === "edit";
  field("teacher-label").textContent = kind === "blend" ? "Second model" : "Teacher model";
  field("percent-group").hidden = kind !== "blend";
  field("editor-group").hidden = kind === "train";
  field("train").textContent = hostMode() ? "Train and save checkpoint" : kind === "train" ? "Train candidate" : "Compare candidate";
  prepareEditor();
}
function hostParent(id) {
  return hostModels.get(id) || { id, name: id };
}
function updateDraftInfo() {
  const draft = hostDrafts.get(drafts.value);
  draftInfo.textContent = draft
    ? "Step " + draft.completedSteps + " of " + draft.totalSteps + " · Base: " + hostParent(draft.parents.base).name +
      " · Teacher: " + hostParent(draft.parents.teacher).name
    : "";
}
function listDrafts(selected = drafts.value) {
  drafts.replaceChildren(...Array.from(hostDrafts.values(), draft =>
    new Option(draft.name + " · " + draft.completedSteps + "/" + draft.totalSteps, draft.id)));
  if (hostDrafts.has(selected)) drafts.value = selected;
  if (!hostDrafts.size) drafts.add(new Option("No saved runs", ""));
  updateDraftInfo();
}
function busy(active) {
  const kind = buildMethod();
  const changingValue = kind !== "train" && typedValue;
  engine.disabled = active || changingValue;
  const available = catalog().size >= (kind === "edit" ? 1 : 2);
  method.disabled = active || changingValue || hostMode() || !models.size;
  base.disabled = active || changingValue || !available;
  field("name").disabled = active || !available;
  teacher.disabled = active || changingValue || !available || kind === "edit";
  percent.disabled = active || changingValue || kind !== "blend";
  editor.disabled = active || kind === "train" || !available || staleEditor;
  editor.readOnly = changingValue;
  parameterValue.disabled = editor.disabled || !validDraft;
  parameter.disabled = parameterValue.disabled || changingValue;
  field("apply").disabled = parameterValue.disabled || !changingValue;
  field("value-cancel").hidden = !changingValue;
  field("value-cancel").disabled = active;
  field("editor-reset").disabled = active || changingValue || kind === "train" || !available;
  field("train").disabled = active || !available || changingValue || (kind !== "train" && staleEditor);
  for (const node of [use, field("answer"), field("chat")]) node.disabled = active || !catalog().size;
  field("import").disabled = active || !db || hostMode();
  field("export").disabled = active || !models.size || hostMode();
  familyFile.disabled = field("import").disabled;
  field("family-export").disabled = field("export").disabled;
  field("family-confirm").disabled = active || !familyDraft || hostMode();
  document.getElementById("host-refresh").disabled = active;
  pause.disabled = active || !hostMode() || hostModels.size < 2;
  drafts.disabled = resume.disabled = active || !hostMode() || !hostDrafts.size;
}
async function refreshMode() {
  invalidate();
  const host = hostMode();
  field("import-group").hidden = host;
  field("family-group").hidden = field("family-export").hidden = host;
  field("source-label").hidden = host;
  field("sentences").disabled = host;
  field("export").hidden = host;
  document.getElementById("host-help").hidden = !host;
  document.getElementById("host-refresh").hidden = !host;
  pause.hidden = !host;
  document.getElementById("host-runs").hidden = !host;
  field("question").maxLength = host ? 2000 : 500;
  field("answer").textContent = host ? "Generate answer" : "Find evidence";
  showMethod();
  field("save").hidden = host;
  busy(true);
  try {
    if (host) {
      hostModels.clear();
      const selectedDraft = drafts.value;
      hostDrafts.clear();
      listDrafts();
      listReaders();
      status.textContent = "Reading local checkpoints…";
      const data = await hostRequest();
      for (const model of data.models) hostModels.set(model.id, hostModel(model));
      for (const draft of data.drafts || []) hostDrafts.set(draft.id, draft);
      listDrafts(selectedDraft);
      status.textContent = !data.configured ? "Local-host training is off. Configure POCKET_TRAINING_DIR on the host to enable it."
        : hostModels.size < 2 ? "Add two compatible checkpoints to the host’s imports folder and refresh." : "";
    } else if (!initialized) {
      await initialize();
    }
    listReaders();
    if (catalog().size >= 2) {
      base.selectedIndex = host ? 0 : 1;
      teacher.selectedIndex = host ? 1 : 0;
    }
    showMethod();
  } catch (error) { status.textContent = error.message; }
  finally { busy(false); }
}
engine.addEventListener("change", refreshMode);
document.getElementById("host-refresh").addEventListener("click", refreshMode);
async function refreshSavedReaders() {
  const saved = await savedReaders(db);
  models.clear();
  for (const entry of [...bundledReaders, ...saved]) models.set(entry.id, entry);
}
async function initialize() {
  status.textContent = "Loading readers…";
  const [hard, soft] = await Promise.all([asset("hard"), asset("soft")]);
  db = await openCatalog();
  const builtin = await Promise.all([modelRecord(hard, "Hard-label reader"), modelRecord(soft, "Soft-label reader")]);
  bundledReaders = builtin.map(entry => ({ ...entry, origin: "Distillation pilot · bundled reader" }));
  await refreshSavedReaders();
  initialized = true;
  status.textContent = "";
}
document.querySelector('[data-view="models"]').addEventListener("click", () => {
  if (!hostMode() && !initialized && !engine.disabled) refreshMode();
});
method.addEventListener("change", () => { invalidate(); showMethod(); busy(false); });
for (const node of [base, teacher, percent]) {
  node.addEventListener("input", () => { invalidate(); prepareEditor(); busy(false); });
}
field("name").addEventListener("input", invalidate);
editor.addEventListener("input", () => { invalidate(); syncParameter(); busy(false); });
parameter.addEventListener("change", syncParameter);
parameterValue.addEventListener("input", () => {
  invalidate();
  typedValue = true;
  field("value-status").textContent = parameterHint();
  busy(false);
});
field("apply").addEventListener("click", () => {
  if (field("apply").disabled) return;
  const value = parameterValue.valueAsNumber;
  if (!Number.isFinite(value) || Math.abs(value) > 1e6) {
    field("value-status").textContent = parameterHint();
    return;
  }
  try {
    // Read the current advanced draft so other manually edited values survive.
    const weights = readWeights(JSON.parse(editor.value));
    const path = parameterPaths.get(parameter.value);
    const container = path.slice(0, -1).reduce((object, key) => object[key], weights);
    container[path.at(-1)] = value;
    editor.value = JSON.stringify(weights, null, 2);
    invalidate();
    syncParameter();
    field("value-status").textContent = "Value applied to the candidate copy.";
    busy(false);
  } catch (error) {
    field("value-status").textContent = error.message || "The parameter could not be applied.";
  }
});
field("value-cancel").addEventListener("click", () => { syncParameter(); busy(false); });
field("editor-reset").addEventListener("click", () => { invalidate(); prepareEditor(true); busy(false); });
use.addEventListener("change", updateOrigin);
drafts.addEventListener("change", updateDraftInfo);

field("import").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  invalidate();
  busy(true);
  try {
    if (file.size > 65536) throw Error("Choose a reader JSON smaller than 64 KiB.");
    let raw;
    try { raw = JSON.parse(await file.text()); }
    catch { throw Error("The selected file could not be read as JSON."); }
    const name = file.name.replace(/\.json$/i, "").slice(0, 64) || "Imported reader";
    await refreshSavedReaders();
    const record = await importReader(raw, name, models);
    const found = models.has(record.id);
    const entry = found ? record : await insertReader(db, record);
    models.set(entry.id, entry);
    listReaders();
    use.value = entry.id;
    updateOrigin();
    status.textContent = (found ? "Already available: " : "Imported: ") + label(entry);
  } catch (error) { status.textContent = error.message; }
  finally { event.target.value = ""; busy(false); }
});

function clearFamilyPreview() {
  familyGeneration++;
  familyDraft = undefined;
  familyFile.value = "";
  if (!familyPreview.hidden) status.textContent = "";
  familyPreview.hidden = true;
  familyPreview.removeAttribute("aria-busy");
  field("family-summary").textContent = "";
  field("family-members").replaceChildren();
  field("family-integrity").hidden = true;
  field("family-differences").hidden = true;
  field("family-difference-list").replaceChildren();
  field("family-confirm").disabled = true;
}

// A later choice must invalidate both the visible confirmation and any validation still in flight.
for (const type of ["input", "change", "submit", "click"]) {
  workshop.addEventListener(type, event => {
    if (familyPreview.hidden || familyPreview.contains(event.target) || event.target === familyFile) return;
    if (type !== "click" || event.target.closest("button")) clearFamilyPreview();
  }, true);
}
new MutationObserver(() => {
  if (workshop.classList.contains("hidden")) clearFamilyPreview();
}).observe(workshop, { attributes: true, attributeFilter: ["class"] });
window.addEventListener("pagehide", clearFamilyPreview);

function showFamilyPreview(family, local) {
  const names = new Map(family.records.map(record => [record.id, record.name]));
  for (const record of local) {
    if (names.has(record.id)) names.set(record.id, record.name);
  }
  const count = family.records.length;
  const identify = id => names.get(id) + " (" + id.replace(/^build-/, "").slice(0, 12) + ")";
  field("family-summary").textContent = names.get(family.root) + " · " + count + (count === 1 ? " model" : " models");
  field("family-members").replaceChildren(...family.records.map(record => {
    const item = document.createElement("li");
    const role = record.id === family.root ? "Selected reader" : "Ancestor";
    const origin = record.run ? runOrigin(record.run, ref => identify(ref.id)) : "Starting weights.";
    item.textContent = role + " · " + identify(record.id) + " · " + origin;
    return item;
  }));
  familyPreview.removeAttribute("aria-busy");
  field("family-integrity").hidden = false;
  const measurement = {
    verifiedPairs: "verified teacher examples",
    "scores.base.correct": "correct base answers", "scores.second.correct": "correct second-parent answers",
    "scores.teacher.correct": "correct teacher answers", "scores.candidate.correct": "correct candidate answers"
  };
  field("family-difference-list").replaceChildren(...family.differences.map(({ id, field, reported, local }) => {
    const item = document.createElement("li");
    item.dataset.modelId = id;
    item.dataset.field = field;
    item.textContent = identify(id) + " · " + (measurement[field] || field) +
      " · file reported " + reported + " · locally measured " + local;
    return item;
  }));
  field("family-differences").hidden = !family.differences.length;
  field("family-confirm").disabled = false;
  status.textContent = "Family ready to import. Review the models before confirming.";
}

familyFile.addEventListener("click", () => {
  if (!familyPreview.hidden) clearFamilyPreview();
});
familyFile.addEventListener("change", async () => {
  const file = familyFile.files[0];
  clearFamilyPreview();
  if (!file || familyFile.disabled || hostMode()) return;
  invalidate();
  const request = familyGeneration;
  familyPreview.hidden = false;
  familyPreview.setAttribute("aria-busy", "true");
  field("family-summary").textContent = "Checking model family…";
  try {
    if (file.size > FAMILY_MAX_BYTES) throw Error("Choose a model family file no larger than 512 KiB.");
    let raw;
    try { raw = JSON.parse(await file.text()); }
    catch { throw Error("Choose a readable model family JSON file."); }
    if (request !== familyGeneration) return;
    const [training, evaluation, saved] = await Promise.all([asset("training"), asset("evaluation"), savedReaders(db)]);
    if (request !== familyGeneration) return;
    const family = await inspectFamily(raw, { training, evaluation });
    if (request !== familyGeneration) return;
    familyDraft = family;
    showFamilyPreview(family, [...bundledReaders, ...saved]);
  } catch (error) {
    if (request !== familyGeneration) return;
    clearFamilyPreview();
    status.textContent = "Family import failed. " + error.message;
  }
});
field("family-cancel").addEventListener("click", () => {
  clearFamilyPreview();
  status.textContent = "Family import canceled.";
  familyFile.focus();
});
field("family-confirm").addEventListener("click", async () => {
  if (!familyDraft || field("family-confirm").disabled || hostMode()) return;
  const family = familyDraft;
  clearFamilyPreview();
  const request = familyGeneration;
  busy(true);
  status.textContent = "Importing model family…";
  try {
    const { added, existing } = await insertFamily(db, family.records, bundledReaders);
    await refreshSavedReaders();
    if (hostMode()) return;
    listReaders();
    if (request !== familyGeneration) {
      if (status.textContent === "Importing model family…") status.textContent = "";
      return;
    }
    use.value = family.root;
    updateOrigin();
    status.textContent = "Imported family " + models.get(family.root).name + ". " + added + " added, " + existing + " already available.";
  } catch (error) {
    if (request === familyGeneration) status.textContent = "Family import failed. " + error.message;
  } finally { busy(false); }
});

function showComparison(scores, parent, tutor, record) {
  field("scores").replaceChildren(...Object.entries(scores).map(([role, score]) => {
    const item = document.createElement("li");
    const model = { base: parent, second: tutor, teacher: tutor, candidate: record }[role];
    item.textContent = role + " · " + model.name + " · " + score.correct + "/" + score.total;
    return item;
  }));
  field("comparison").hidden = false;
}

function showHostResult(result, expectedParents, expectedId) {
  const item = result.draft || result.candidate;
  if (!item || item.parents?.base !== expectedParents.base || item.parents?.teacher !== expectedParents.teacher ||
      (expectedId && expectedId !== item.id)) {
    throw Error("The host returned a different training run. Refresh the host catalog.");
  }
  if (result.draft) {
    hostDrafts.set(item.id, item);
    listDrafts(item.id);
    status.textContent = "Paused at step " + item.completedSteps + " of " + item.totalSteps + ". This host has saved your run.";
    return;
  }
  const record = hostModel(item);
  hostModels.set(record.id, record);
  hostDrafts.delete(record.id);
  listDrafts();
  listReaders();
  use.value = record.id;
  updateOrigin();
  showComparison(result.scores, hostParent(item.parents.base), hostParent(item.parents.teacher), record);
  status.textContent = "Checkpoint saved after training on " + result.verifiedExamples + " verified teacher examples.";
}

resume.addEventListener("click", async () => {
  if (!hostMode() || resume.disabled) return;
  const draft = hostDrafts.get(drafts.value);
  if (!draft) return;
  invalidate();
  busy(true);
  status.textContent = "Resuming " + draft.name + " from step " + draft.completedSteps + " on the local host…";
  try {
    const result = await hostRequest({ op: "resume", draft: draft.id });
    showHostResult(result, draft.parents, draft.id);
  } catch (error) {
    status.textContent = error.message + " Refresh host models to check the saved run’s current step.";
  } finally { busy(false); }
});
field("build").addEventListener("submit", async event => {
  event.preventDefault();
  if (field("train").disabled) return;
  invalidate();
  const parent = catalog().get(base.value), tutor = catalog().get(teacher.value);
  const name = field("name").value.trim();
  const kind = buildMethod();
  if (!name || (kind !== "edit" && parent.hash === tutor.hash)) {
    status.textContent = !name ? "Give the new reader a name." : "Choose two readers with different weights.";
    return;
  }
  busy(true);
  status.textContent = kind === "train" ? "Training from the selected base…" : "Comparing candidate weights…";
  try {
    if (hostMode()) {
      const parents = { base: parent.id, teacher: tutor.id };
      const request = { op: "build", ...parents, name };
      if (event.submitter === pause) request.throughStep = 12;
      status.textContent = request.throughStep ? "Training to step 12 on the local host…" : "Training on the local host…";
      showHostResult(await hostRequest(request), parents);
      return;
    }
    if (kind !== "train") {
      let weights;
      try { weights = JSON.parse(editor.value); }
      catch { throw Error("Enter valid JSON for the candidate weights."); }
      const record = await reviewEdit({
        base: parent, ...(kind === "blend" ? { second: tutor, rightPercent: percent.valueAsNumber } : {}),
        weights, name, evaluation: await asset("evaluation"), evaluationHash: sources.evaluation
      });
      const count = record.run.editedParameters;
      field("edit-summary").textContent = runOrigin(record.run) + " " + count + " manually changed parameter" +
        (count === 1 ? "" : "s") + " compared with the " + (kind === "blend" ? "starting blend." : "base.");
      field("edit-summary").hidden = false;
      pending = record;
      showComparison(record.run.scores, parent, tutor, record);
      field("save").disabled = false;
      status.textContent = "Comparison ready. Review the scores and save to keep this candidate.";
      return;
    }
    const result = train(parent.weights, tutor.weights, await asset("training"));
    const record = await modelRecord(result.weights, name);
    if ([parent.hash, tutor.hash].includes(record.hash)) throw Error("Training did not produce distinct candidate weights.");
    const evaluation = await asset("evaluation");
    const scores = { base: evaluate(parent.weights, evaluation), teacher: evaluate(tutor.weights, evaluation),
      candidate: evaluate(record.weights, evaluation) };
    const ref = entry => ({ id: entry.id, hash: entry.hash, label: label(entry) });
    const run = { recipe, base: ref(parent), teacher: ref(tutor), training: sources.training, evaluation: sources.evaluation,
      verifiedPairs: result.verifiedPairs, scores };
    // Identify the build independently of its display name and the weight digest.
    record.id = await trainingBuildId(parent.id, tutor.id, record.hash);
    pending = { ...record, run };
    showComparison(scores, parent, tutor, record);
    field("save").disabled = false;
    status.textContent = "Trained on " + result.verifiedPairs + " verified sentence pairs. Review the scores before saving.";
  } catch (error) {
    status.textContent = hostMode() ? error.message + " Refresh host models to check saved progress." : error.message;
  }
  finally { busy(false); }
});
field("save").addEventListener("click", async () => {
  if (!pending || field("save").disabled) return;
  field("save").disabled = true;
  busy(true);
  try {
    const saved = await insertReader(db, pending);
    if (buildMethod() !== "train") originalText = editor.value;
    models.set(saved.id, saved);
    listReaders();
    use.value = saved.id;
    updateOrigin();
    status.textContent = label(saved) + " is saved and available in both parent menus.";
  } catch (error) {
    status.textContent = error.message;
    field("save").disabled = false;
  } finally { busy(false); }
});
field("try").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const record = catalog().get(use.value);
    if (hostMode()) {
      busy(true);
      field("output").textContent = "Generating on the local host…";
      field("output").textContent = (await hostRequest({ op: "answer", model: record.id, question: field("question").value })).answer;
    } else {
      field("output").textContent = readPassage(record.weights, field("question").value, field("sentences").value).answer;
    }
  } catch (error) { field("output").textContent = error.message; }
  finally { busy(false); }
});
field("chat").addEventListener("click", () => {
  const record = catalog().get(use.value);
  if (record.location === "host") {
    selectChatReader({
      name: record.name, label: label(record), id: record.id, hash: record.hash, location: "host", parents: record.parents,
      async answer(question) {
        const result = await hostRequest({ op: "answer", model: record.id, question });
        const sourceHash = await digest(new TextEncoder().encode(question.trim()));
        return { question, answer: result.answer, sourceHash };
      }
    }, field("question").value);
    return;
  }
  const reader = {
    name: record.name, label: label(record), id: record.id, hash: record.hash, run: record.run,
    importedFamily: record.importedFamily === true,
    async answer(question, passage) {
      const result = readPassage(record.weights, question, passage);
      const sourceHash = await digest(new TextEncoder().encode(JSON.stringify(result.sentences)));
      return { question: result.question, answer: result.answer, index: result.index, sourceHash };
    }
  };
  selectChatReader(reader, field("question").value, field("sentences").value);
});
function downloadJson(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
field("export").addEventListener("click", () => {
  const record = models.get(use.value);
  downloadJson(JSON.stringify(exportReader(record)) + "\n", "reader-" + record.hash.slice(0, 12) + ".json");
});
field("family-export").addEventListener("click", () => {
  if (hostMode() || field("family-export").disabled) return;
  try {
    const record = models.get(use.value);
    const bundle = exportFamily(record.id, models);
    downloadJson(JSON.stringify(bundle), "reader-family-" + record.id + ".json");
    status.textContent = "Exported the model family for " + record.name + ".";
  } catch (error) { status.textContent = "Family export failed. " + error.message; }
});

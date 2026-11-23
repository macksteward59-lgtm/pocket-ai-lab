import { hostRequest, hostModel } from "./host.js";
import { evaluate, readPassage, recipe, train } from "./reader.js";
import { asset, digest, insertReader, modelRecord, openCatalog, savedReaders, sources } from "./catalog.js";

const field = name => document.getElementById("reader-" + name);
const status = field("status"), base = field("base"), teacher = field("teacher"), use = field("use");
const models = new Map(), hostModels = new Map();
const engine = document.getElementById("workshop-engine");
const hostMode = () => engine.value === "host";
const catalog = () => hostMode() ? hostModels : models;
let db, pending;
let initialized = false;
const label = entry => entry.name + " · " + entry.hash.slice(0, 8);

function updateOrigin() {
  const entry = catalog().get(use.value);
  field("origin").textContent = entry?.run
    ? "Built from " + entry.run.base.label + " with " + entry.run.teacher.label + " as teacher. Held-out score " +
      entry.run.scores.candidate.correct + "/" + entry.run.scores.candidate.total + "."
    : entry?.location === "host" ? (entry.parents ? "Base " + entry.parents.base + " · Teacher " + entry.parents.teacher : "Host-installed language model.")
    : entry?.origin || (entry ? "Imported document reader." : "");
  field("output").textContent = "";
}
function listReaders() {
  for (const select of [base, teacher, use]) {
    const selected = select.value;
    select.replaceChildren(...Array.from(catalog().values(), record => new Option(label(record), record.id)));
    if (catalog().has(selected)) select.value = selected;
  }
  updateOrigin();
}
function invalidate() {
  pending = undefined;
  field("comparison").hidden = true;
  status.textContent = "";
}
function busy(active) {
  engine.disabled = active;
  for (const node of [base, teacher, field("name"), field("train")]) node.disabled = active || catalog().size < 2;
  for (const node of [use, field("answer"), field("chat")]) node.disabled = active || !catalog().size;
  field("import").disabled = active || !db || hostMode();
  field("export").disabled = active || !models.size || hostMode();
  document.getElementById("host-refresh").disabled = active;
}
async function refreshMode() {
  invalidate();
  const host = hostMode();
  field("import-group").hidden = host;
  field("source-label").hidden = host;
  field("sentences").disabled = host;
  field("export").hidden = host;
  document.getElementById("host-help").hidden = !host;
  document.getElementById("host-refresh").hidden = !host;
  field("question").maxLength = host ? 2000 : 500;
  field("answer").textContent = host ? "Generate answer" : "Find evidence";
  field("train").textContent = host ? "Train and save checkpoint" : "Train candidate";
  field("save").hidden = host;
  busy(true);
  try {
    if (host) {
      hostModels.clear();
      listReaders();
      status.textContent = "Reading local checkpoints…";
      const data = await hostRequest();
      for (const model of data.models) hostModels.set(model.id, hostModel(model));
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
  } catch (error) { status.textContent = error.message; }
  finally { busy(false); }
}
engine.addEventListener("change", refreshMode);
document.getElementById("host-refresh").addEventListener("click", refreshMode);
async function initialize() {
  status.textContent = "Loading readers…";
  const [hard, soft] = await Promise.all([asset("hard"), asset("soft")]);
  db = await openCatalog();
  const builtin = await Promise.all([modelRecord(hard, "Hard-label reader"), modelRecord(soft, "Soft-label reader")]);
  for (const entry of builtin) models.set(entry.id, { ...entry, origin: "Distillation pilot · bundled reader" });
  for (const entry of await savedReaders(db)) models.set(entry.id, entry);
  initialized = true;
  status.textContent = "";
}
document.querySelector('[data-view="models"]').addEventListener("click", () => {
  if (!hostMode() && !initialized && !engine.disabled) refreshMode();
});
for (const node of [base, teacher, field("name")]) node.addEventListener("input", invalidate);
use.addEventListener("change", updateOrigin);

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
    const record = await modelRecord(raw, name);
    const found = [...models.values()].find(entry => entry.hash === record.hash);
    const entry = found ?? await insertReader(db, record);
    models.set(entry.id, entry);
    listReaders();
    use.value = entry.id;
    updateOrigin();
    status.textContent = (found ? "Already available: " : "Imported: ") + label(entry);
  } catch (error) { status.textContent = error.message; }
  finally { event.target.value = ""; busy(false); }
});

function showComparison(scores, parent, tutor, record) {
  field("scores").replaceChildren(...Object.entries(scores).map(([role, score]) => {
    const item = document.createElement("li");
    const model = { base: parent, teacher: tutor, candidate: record }[role];
    item.textContent = role + " · " + model.name + " · " + score.correct + "/" + score.total;
    return item;
  }));
  field("comparison").hidden = false;
}
field("build").addEventListener("submit", async event => {
  event.preventDefault();
  if (field("train").disabled) return;
  invalidate();
  const parent = catalog().get(base.value), tutor = catalog().get(teacher.value);
  const name = field("name").value.trim();
  if (!name || parent.hash === tutor.hash) {
    status.textContent = !name ? "Give the new reader a name." : "Choose two readers with different weights.";
    return;
  }
  busy(true);
  status.textContent = "Training from the selected base…";
  try {
    if (hostMode()) {
      status.textContent = "Training on the local host. The checkpoint will appear in the host catalog.";
      const result = await hostRequest({ op: "build", base: parent.id, teacher: tutor.id, name });
      const record = hostModel(result.candidate);
      hostModels.set(record.id, record);
      listReaders();
      use.value = record.id;
      updateOrigin();
      showComparison(result.scores, parent, tutor, record);
      status.textContent = "Checkpoint saved after training on " + result.verifiedExamples + " verified teacher examples.";
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
    const buildKey = [recipe, parent.id, tutor.id, run.training, run.evaluation, record.hash];
    record.id = "build-" + await digest(new TextEncoder().encode(JSON.stringify(buildKey)));
    pending = { ...record, run };
    showComparison(scores, parent, tutor, record);
    field("save").disabled = false;
    status.textContent = "Trained on " + result.verifiedPairs + " verified sentence pairs. Review the scores before saving.";
  } catch (error) { status.textContent = error.message; }
  finally { busy(false); }
});
field("save").addEventListener("click", async () => {
  if (!pending || field("save").disabled) return;
  field("save").disabled = true;
  busy(true);
  try {
    const saved = await insertReader(db, pending);
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
    async answer(question, passage) {
      const result = readPassage(record.weights, question, passage);
      const sourceHash = await digest(new TextEncoder().encode(JSON.stringify(result.sentences)));
      return { question: result.question, answer: result.answer, index: result.index, sourceHash };
    }
  };
  selectChatReader(reader, field("question").value, field("sentences").value);
});
field("export").addEventListener("click", () => {
  const record = models.get(use.value);
  const payload = { ...record.weights, workshop: { name: record.name, weightsSHA256: record.hash, run: record.run ?? null } };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload) + "\n"], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "reader-" + record.hash.slice(0, 12) + ".json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
});

import { evaluate, features, pick, recipe, train } from "./reader.js";
import { asset, digest, insertReader, modelRecord, openCatalog, savedReaders, sources } from "./catalog.js";

const field = name => document.getElementById("reader-" + name);
const status = field("status"), base = field("base"), teacher = field("teacher"), use = field("use");
const models = new Map();
let db, loading, pending;
const label = entry => entry.name + " · " + entry.hash.slice(0, 8);

function updateOrigin() {
  const entry = models.get(use.value);
  field("origin").textContent = entry?.run
    ? "Built from " + entry.run.base.label + " with " + entry.run.teacher.label + " as teacher. Held-out score " +
      entry.run.scores.candidate.correct + "/" + entry.run.scores.candidate.total + "."
    : entry?.origin || "Imported document reader.";
  field("output").textContent = "";
}
function listReaders() {
  for (const select of [base, teacher, use]) {
    const selected = select.value;
    select.replaceChildren(...Array.from(models.values(), record => new Option(label(record), record.id)));
    if (models.has(selected)) select.value = selected;
  }
  updateOrigin();
}
function invalidate() {
  pending = undefined;
  field("comparison").hidden = true;
  status.textContent = "";
}
function busy(active) {
  for (const node of [base, teacher, field("import"), field("name"), field("train")]) node.disabled = active;
}
async function initialize() {
  status.textContent = "Loading readers…";
  const [hard, soft] = await Promise.all([asset("hard"), asset("soft")]);
  db = await openCatalog();
  const builtin = await Promise.all([modelRecord(hard, "Hard-label reader"), modelRecord(soft, "Soft-label reader")]);
  for (const entry of builtin) models.set(entry.id, { ...entry, origin: "Distillation pilot · bundled reader" });
  for (const entry of await savedReaders(db)) models.set(entry.id, entry);
  listReaders();
  base.value = builtin[1].id;
  teacher.value = builtin[0].id;
  busy(false);
  for (const node of [use, field("answer"), field("export")]) node.disabled = false;
  status.textContent = "";
}
document.querySelector('[data-view="models"]').addEventListener("click", () => {
  loading ??= initialize().catch(error => { loading = undefined; status.textContent = error.message; });
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

field("build").addEventListener("submit", async event => {
  event.preventDefault();
  if (field("train").disabled) return;
  invalidate();
  const parent = models.get(base.value), tutor = models.get(teacher.value);
  const name = field("name").value.trim();
  if (!name || parent.hash === tutor.hash) {
    status.textContent = !name ? "Give the new reader a name." : "Choose two readers with different weights.";
    return;
  }
  busy(true);
  status.textContent = "Training from the selected base…";
  try {
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
    field("scores").replaceChildren(...Object.entries(scores).map(([role, score]) => {
      const item = document.createElement("li");
      const model = { base: parent, teacher: tutor, candidate: record }[role];
      item.textContent = role + " · " + model.name + " · " + score.correct + "/" + score.total;
      return item;
    }));
    field("comparison").hidden = false;
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
field("try").addEventListener("submit", event => {
  event.preventDefault();
  const sentences = field("sentences").value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const question = field("question").value.trim();
  if (!question || !sentences.length || sentences.length > 64) {
    field("output").textContent = "Enter a question and between 1 and 64 source sentences.";
    return;
  }
  const i = pick(models.get(use.value).weights, features(question, sentences));
  field("output").textContent = i < 0 ? "UNKNOWN · insufficient evidence" : sentences[i];
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

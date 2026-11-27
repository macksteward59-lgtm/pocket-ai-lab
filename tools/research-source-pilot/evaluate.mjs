import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonical, sha256, validateCorpus, toWorkshop, citationFor, summarize } from "./validate.mjs";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
const FROZEN_FILES = ["sources.json", "cases.json", "baseline.json"];
const SHA = /^[0-9a-f]{64}$/;

async function fileBytes(file, max = 256 * 1024) {
  const bytes = await readFile(file);
  if (bytes.length > max) throw Error("Input exceeds limit: " + path.basename(file));
  return bytes;
}
function same(a, b) { return canonical(a) === canonical(b); }

export async function loadFrozen(expectedFreeze, directory = HERE, root = ROOT) {
  if (!SHA.test(expectedFreeze)) throw Error("Supply the independently retained freeze SHA-256.");
  const freezeBytes = await fileBytes(path.join(directory, "freeze.json"));
  if (sha256(freezeBytes) !== expectedFreeze) throw Error("Freeze digest mismatch");
  const freeze = JSON.parse(freezeBytes);
  if (freeze.schema !== "pocket-source-pilot-freeze-v1" ||
      !same(Object.keys(freeze.files).sort(), [...FROZEN_FILES].sort())) throw Error("Unsupported freeze manifest");
  const data = {};
  for (const name of FROZEN_FILES) {
    const bytes = await fileBytes(path.join(directory, name));
    if (!SHA.test(freeze.files[name]) || sha256(bytes) !== freeze.files[name]) throw Error("Frozen file digest mismatch: " + name);
    data[name] = JSON.parse(bytes);
  }
  const corpus = data["sources.json"], suite = data["cases.json"], baseline = data["baseline.json"];
  const validated = validateCorpus(corpus, suite);
  if (!same(Object.fromEntries(validated.families), freeze.family_splits)) throw Error("Frozen family split mismatch");
  if (baseline.revision !== freeze.baseline_revision || !/^[0-9a-f]{40}$/.test(baseline.revision) ||
      baseline.repository !== "macksteward59-lgtm/pocket-ai-lab") throw Error("Baseline revision mismatch");
  const assets = new Map(), paths = new Set();
  for (const entry of baseline.files) {
    if (typeof entry.path !== "string" || !/^(apps\/web\/model-workshop\/[a-z-]+\.(js|json)|package\.json)$/.test(entry.path) ||
        paths.has(entry.path) || !SHA.test(entry.sha256)) throw Error("Invalid baseline file path or digest");
    paths.add(entry.path);
    const bytes = await fileBytes(path.join(root, entry.path));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw Error("Pinned baseline changed: " + entry.path);
    assets.set(entry.path, bytes);
  }
  for (const name of ["reader.js", "compare.js", "catalog.js", "identity.js", "edit.js", "family.js", "soft.json", "hard.json"]) {
    if (!assets.has("apps/web/model-workshop/" + name)) throw Error("Required baseline file missing: " + name);
  }
  return { freeze, corpus, suite, baseline, assets };
}

export async function evaluateFrozen(expectedFreeze, outputDirectory) {
  const { freeze, corpus, suite, baseline, assets } = await loadFrozen(expectedFreeze);
  // Verify the complete dependency snapshot before importing any baseline module.
  const { modelRecord } = await import("../../apps/web/model-workshop/catalog.js");
  const { compareReaders } = await import("../../apps/web/model-workshop/compare.js");
  const { features, forward } = await import("../../apps/web/model-workshop/reader.js");
  const documents = toWorkshop(corpus, suite);
  // Use the app's existing import/compare entry point. Gold labels affect grading only.
  const rows = [], models = [], byCase = new Map();
  for (const source of corpus.sources) for (const item of suite.cases.filter(c => c.source_id === source.id)) {
    const row = { id: item.id, source_id: source.id, kind: item.kind,
      expected_note_id: item.expected_note_id, outputs: [] };
    rows.push(row); byCase.set(item.id, row);
  }
  for (const key of ["soft", "hard"]) {
    const modelPath = "apps/web/model-workshop/" + key + ".json";
    const raw = assets.get(modelPath);
    const record = await modelRecord(JSON.parse(raw), "Unchanged bundled " + key + " reader");
    models.push({ key, asset_path: modelPath, asset_sha256: sha256(raw),
      model_id: record.id, weights_sha256: record.hash,
      weights_json: JSON.stringify(record.weights), engine: "pocket-workshop-v1", training_in_this_run: false });
    const compared = await compareReaders(record.id, new Map([[record.id, record]]), documents);
    let index = 0;
    for (const source of corpus.sources) for (const item of suite.cases.filter(c => c.source_id === source.id)) {
      const answer = compared.cases[index++].results[0];
      const note = answer.index < 0 ? null : source.notes[answer.index];
      const probabilities = features(item.question, source.notes.map(n => n.text)).map(f => forward(record.weights, f).score);
      const expected = item.expected_note_id;
      byCase.get(item.id).outputs.push({ model_key: key, decision: note ? "answer" : "abstain",
        selected_note_id: note?.id ?? null, answer_sha256: sha256(answer.answer),
        citation: note ? citationFor(source, note) : null,
        citation_binding_valid: note ? true : null,
        correct: (note?.id ?? null) === expected, probabilities });
    }
  }
  const report = { schema: "pocket-source-pilot-report-v1", freeze_sha256: expectedFreeze,
    baseline_revision: baseline.revision, evaluation_kind: "visible-development-fixture",
    execution_scope: "node-host-curated-notes", model_training: false, remote_actions: false,
    primary_source_semantics_independently_proven: false,
    models, cases: rows, metrics: summarize(rows, models.map(m => m.key)) };
  const output = path.resolve(outputDirectory);
  if (output === HERE || output === ROOT) throw Error("Choose a separate output directory.");
  await mkdir(output, { recursive: true });
  const reportBytes = JSON.stringify(report, null, 2) + "\n";
  await writeFile(path.join(output, "report.json"), reportBytes);
  await writeFile(path.join(output, "report.sha256"), sha256(reportBytes) + "\n");
  await writeFile(path.join(output, "workshop-comparison.json"), JSON.stringify(documents, null, 2) + "\n");
  await writeFile(path.join(output, "run-environment.json"), JSON.stringify({
    generated_at: new Date().toISOString(), node: process.version, platform: process.platform,
    architecture: process.arch, report_sha256: sha256(reportBytes), freeze_sha256: expectedFreeze,
    evaluator_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    validator_sha256: sha256(await readFile(path.join(HERE, "validate.mjs"))),
    note: "Environment metadata is descriptive and is not an execution attestation."
  }, null, 2) + "\n");
  return { report, report_sha256: sha256(reportBytes), output_directory: output,
    frozen_files: Object.keys(freeze.files) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , freeze, output, ...rest] = process.argv;
  if (!freeze || !output || rest.length) {
    console.error("Usage: node tools/research-source-pilot/evaluate.mjs TRUSTED-FREEZE-SHA256 OUTPUT-DIRECTORY");
    process.exitCode = 2;
  } else {
    try {
      const result = await evaluateFrozen(freeze, output);
      console.log(JSON.stringify({ report_sha256: result.report_sha256, output_directory: result.output_directory,
        metrics: result.report.metrics }, null, 2));
    } catch (error) { console.error("Evaluation failed:", error.message); process.exitCode = 1; }
  }
}

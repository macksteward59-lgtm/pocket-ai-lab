import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadFrozenProfile } from "./profile.mjs";
import { loadNamedPin } from "../local-gguf/lib.mjs";

test("v4 changes the code/feedback contract while preserving the frozen experiment controls", async () => {
  const [{ profile: previous }, { profile: current }] = await Promise.all([
    loadFrozenProfile("v3"), loadFrozenProfile("v4")
  ]);
  const changed = new Set(["id", "interpretation", "independentAnalysisSchemaMaxCharacters",
    "sourceContract", "developmentFeedback"]);
  const controls = profile => Object.fromEntries(Object.entries(profile).filter(([key]) => !changed.has(key)));
  assert.deepEqual(controls(current), controls(previous));
  assert.equal(current.sourceContract, "python-source-v1");
  assert.equal(current.developmentFeedback, "bounded-failure-diagnostics-v1");
  assert.equal(current.providerRepairAttempts, 0);
  assert.equal(current.maxRevisions, 2);
  assert.equal(current.maxDirectorTurns, 3);
  assert.equal(current.independentAnalysisSchemaMaxCharacters, undefined);
});

test("v5 changes only illustrative source prompts and remaining revision advertisement", async () => {
  const [{ profile: previous }, { profile: current }] = await Promise.all([
    loadFrozenProfile("v4"), loadFrozenProfile("v5")
  ]);
  const changed = new Set(["id", "interpretation", "sourceContract", "revisionAvailability"]);
  const controls = profile => Object.fromEntries(Object.entries(profile).filter(([key]) => !changed.has(key)));
  assert.deepEqual(controls(current), controls(previous));
  assert.equal(previous.sourceContract, "python-source-v1");
  assert.equal(previous.revisionAvailability, undefined);
  assert.equal(current.sourceContract, "python-source-v2");
  assert.equal(current.revisionAvailability, "remaining-builder-attempts-v1");
});

test("baseline is an explicit model and feedback qualification with unchanged quality controls", async () => {
  const [{ profile: previous }, current] = await Promise.all([
    loadFrozenProfile("v5"), loadFrozenProfile("baseline-v1")
  ]);
  const changed = new Set(["id", "interpretation", "modelId", "modelSHA256", "modelBytes", "serverAlias",
    "providerTimeoutMs", "reasoningBudget", "feedbackContract", "acquisitionTimeoutMs", "hostResourceRecord"]);
  const controls = profile => Object.fromEntries(Object.entries(profile).filter(([key]) => !changed.has(key)));
  assert.deepEqual(controls(current.profile), controls(previous));
  assert.equal(previous.feedbackContract, undefined);
  assert.equal(previous.reasoningBudget, 128);
  assert.equal(current.profile.feedbackContract, "host-artifact-summary-v1");
  assert.equal(current.profile.reasoningBudget, undefined);
  assert.equal(current.profile.providerTimeoutMs, 300000);
  assert.equal(current.profile.acquisitionTimeoutMs, 900000);
  const pin = await loadNamedPin(current.profile.modelId);
  assert.equal(pin.sha256, current.profile.modelSHA256);
  assert.equal(pin.bytes, current.profile.modelBytes);
  assert.equal(pin.repo, "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF");
  const request = JSON.parse(await readFile(new URL("./run-request-baseline-v1.json", import.meta.url), "utf8"));
  assert.equal(request.profileSHA256, current.digest);
  assert.equal(request.profile, current.profile.id);
  const catalog = JSON.parse(await readFile(new URL("../local-gguf/pins.json", import.meta.url), "utf8"));
  assert.equal(catalog.default, "smollm2-135m-instruct-q4_k_m");
});

test("old profiles retain their hashed legacy contract and unknown selections never fall back", async () => {
  for (const name of ["v1", "v2", "v3"]) {
    const { profile } = await loadFrozenProfile(name);
    assert.equal(profile.independentAnalysisSchemaMaxCharacters, 700);
    assert.equal(profile.sourceContract, undefined);
    assert.equal(profile.developmentFeedback, undefined);
  }
  for (const name of ["", "latest", "v6", "baseline-v2", "../model-profile-v4"]) {
    await assert.rejects(loadFrozenProfile(name), /must be exactly/);
  }
});

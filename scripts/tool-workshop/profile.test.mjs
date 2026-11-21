import test from "node:test";
import assert from "node:assert/strict";
import { loadFrozenProfile } from "./profile.mjs";

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

test("old profiles retain their hashed legacy contract and unknown selections never fall back", async () => {
  for (const name of ["v1", "v2", "v3"]) {
    const { profile } = await loadFrozenProfile(name);
    assert.equal(profile.independentAnalysisSchemaMaxCharacters, 700);
    assert.equal(profile.sourceContract, undefined);
    assert.equal(profile.developmentFeedback, undefined);
  }
  for (const name of ["", "latest", "v5", "../model-profile-v4"]) {
    await assert.rejects(loadFrozenProfile(name), /must be exactly/);
  }
});

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deriveRule, reviewAdvisory, runDemo } from './run.mjs';
import { verify } from './verify.mjs';

function makeRun(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pocket-prevention-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return runDemo(join(directory, 'bundle'));
}

test('real replay denies only the protected write and the saved bundle independently verifies', t => {
  const result = makeRun(t);
  assert.equal(verify(result.root, result.evidenceSha256), result.evidenceSha256);
  assert.throws(() => runDemo(result.root), { code: 'EEXIST' });
  assert.equal(verify(result.root), result.evidenceSha256);
});

test('a different run, file, revision, unchanged file or clean verdict cannot generate the rule', t => {
  const { root } = makeRun(t);
  const { execution, observation } = JSON.parse(readFileSync(join(root, 'evidence.json')));
  for (const patch of [
    { runId: 'another-run' }, { file: 'control.txt' }, { sha256: execution.before }, { indicator: null }
  ]) {
    assert.throws(() => deriveRule(execution, { ...observation, ...patch }), /do not support/);
  }
  assert.throws(() => deriveRule({ ...execution, before: execution.after }, observation), /do not support/);
});

test('prior catalog entry is kept and does not become a duplicate advisory', () => {
  const rule = { application: 'pocket-note-writer', operation: 'write',
    file: 'review-note.txt', indicator: 'fixture-marker-v1' };
  const first = reviewAdvisory(rule, []);
  assert.equal(first.lookup, 'no-local-match');
  const repeat = reviewAdvisory(rule, first.entries);
  assert.equal(repeat.lookup, 'known-fixture');
  assert.deepEqual(repeat.entries, first.entries);
});

test('the verifier detects changed bytes, an altered alert and a mismatched saved digest', t => {
  const { root } = makeRun(t);
  assert.throws(() => verify(root, '0'.repeat(64)), /digest/);
  const alert = join(root, 'developer-inbox.json');
  const original = readFileSync(alert);
  writeFileSync(alert, '[]');
  assert.throws(() => verify(root));
  writeFileSync(alert, original);
  writeFileSync(join(root, 'fixture/review-note.txt'), 'changed after the run');
  assert.throws(() => verify(root));
});

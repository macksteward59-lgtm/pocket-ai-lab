// Offline readback of an owned fixture bundle. This reader never runs the recorded writer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function verify(root, expectedDigest) {
  const read = file => readFileSync(join(root, file));
  const evidence = read('evidence.json');
  const digest = hash(evidence);
  if (expectedDigest !== undefined) assert.equal(digest, expectedDigest, 'saved evidence digest');
  const { schema, runId, execution, observation, rule, replay, catalogBefore, lookup, advisoryKey } =
    JSON.parse(evidence);
  const protectedName = 'review-note.txt';
  const protectedBytes = read('fixture/' + protectedName);
  const expectedKey = 'pocket-note-writer/write/review-note.txt/fixture-marker-v1';
  assert.equal(schema, 1);
  assert.match(runId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(execution.runId, runId);
  assert.equal(execution.application, 'pocket-note-writer');
  assert.equal(execution.scriptSha256, hash(readFileSync(new URL('./writer.cjs', import.meta.url))));
  assert.equal(execution.file, protectedName);
  assert.deepEqual(execution.event, { operation: 'write', file: protectedName, result: 'written' });
  assert.equal(execution.before, hash('original note\n'));
  assert.equal(protectedBytes.toString('utf8'), 'POCKET_TEST_MARKER\nrevision 1\n');
  const finalDigest = hash(protectedBytes);
  assert.equal(execution.after, finalDigest);
  assert.deepEqual(observation, { runId, file: protectedName, sha256: finalDigest, indicator: 'fixture-marker-v1' });
  assert.deepEqual(rule, { application: execution.application, operation: 'write', file: protectedName,
    evidenceSha256: finalDigest, indicator: observation.indicator });
  assert.deepEqual(replay.permitted, ['control.txt']);
  assert.deepEqual(replay.events, [
    { operation: 'write', file: protectedName, result: 'denied', code: 'ERR_ACCESS_DENIED' },
    { operation: 'write', file: 'control.txt', result: 'written' }
  ]);
  assert.equal(replay.afterReplay, finalDigest);
  assert.equal(replay.controlBefore, hash('original control\n'));
  assert.equal(read('fixture/control.txt').toString('utf8'), 'control write succeeded\n');
  assert.equal(replay.controlAfter, hash(read('fixture/control.txt')));
  assert.equal(advisoryKey, expectedKey);
  assert.deepEqual(catalogBefore, [{ key: 'unrelated/fixture', status: 'known-test-case' }]);
  assert.equal(lookup, 'no-local-match');
  assert.deepEqual(JSON.parse(read('advisories.json')), [
    ...catalogBefore, { key: expectedKey, status: 'unmatched-needs-review' }
  ]);
  assert.deepEqual(JSON.parse(read('developer-inbox.json')), [{
    runId, recipient: 'fixture-maintainer', delivery: 'local-inbox', application: execution.application,
    file: protectedName, sha256: finalDigest, advisoryKey: expectedKey, lookup,
    classification: 'synthetic-marker', vulnerabilityConfirmed: false
  }]);
  return digest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, expectedDigest, ...extra] = process.argv.slice(2);
  if (!root || extra.length) throw new Error('Usage: node verify.mjs directory [saved-evidence-sha256]');
  console.log('Verified fixture evidence:', verify(root, expectedDigest));
}

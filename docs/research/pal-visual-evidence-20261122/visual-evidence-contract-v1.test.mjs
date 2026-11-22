import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTRACT_VERSION, sha256, verifyVisualFixture, evaluateSyntheticAccessPair} from './visual-evidence-contract-v1.mjs';

// Static 1x1 white PNG fixture; never a screenshot of a real service.
const screenshotBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9s5TaoYAAAAASUVORK5CYII=', 'base64');
const snapshotText = 'button "View record"; text "Tenant A fixture"';
const networkSummary = 'GET /fixture/resource/A => 200 [synthetic, no cookies]';
const trusted = {expectedTaskId:'task-visual-01',scopeId:'scope-fixture-01',allowedOrigins:['http://127.0.0.1:38081']};
const makeRecord = () => ({
  contractVersion:CONTRACT_VERSION, taskId:'task-visual-01', attemptId:'attempt-01', captureId:'capture-01',
  scopeId:'scope-fixture-01', dataClass:'synthetic-owned-fixture', redactionReview:'synthetic-no-user-data',
  contentKind:'image/png', pageUrl:'http://127.0.0.1:38081/fixture/resource/A', redirects:[],
  screenshotSha256:sha256(screenshotBytes), snapshotSha256:sha256(snapshotText),
  networkSummarySha256:sha256(networkSummary),
});
const inputs = {screenshotBytes, snapshotText, networkSummary};

test('accepts only byte-consistent synthetic evidence; cannot assert authority', () => {
  const got = verifyVisualFixture(makeRecord(), inputs, trusted);
  assert.equal(got.status,'fixture-evidence-consistent-only');
  for (const k of ['authorizationProven','modelExecutionProven','vulnerabilityProven','privacySafetyProven']) {
    assert.equal(got[k],false);
  }
});
test('rejects non-PNG data even if a digest is forged to match', () => {
  const r=makeRecord(); const modified=Buffer.from('not a PNG'); r.screenshotSha256=sha256(modified);
  assert.throws(()=>verifyVisualFixture(r,{...inputs,screenshotBytes:modified},trusted),/PNG signature/);
});
test('rejects modified screenshot bytes', () => {
  const changed=Buffer.from(screenshotBytes);changed[changed.length-1]^=1;
  assert.throws(()=>verifyVisualFixture(makeRecord(), {...inputs,screenshotBytes:changed},trusted),/digest mismatch/);
});
test('rejects modified accessibility snapshot', () => {
  assert.throws(()=>verifyVisualFixture(makeRecord(), {...inputs,snapshotText:'forged'},trusted),/digest mismatch/);
});
test('rejects out-of-scope redirect even with initially allowed URL', () => {
  const r=makeRecord();r.redirects=['http://example.com/steal'];
  assert.throws(()=>verifyVisualFixture(r,inputs,trusted),/loopback/);
});
test('rejects unapproved port', () => {
  const r=makeRecord();r.pageUrl='http://127.0.0.1:38082/fixture';
  assert.throws(()=>verifyVisualFixture(r,inputs,trusted),/outside trusted fixture allowlist/);
});
test('rejects cross-task evidence replay', () => {
  const r=makeRecord();r.taskId='task-other';
  assert.throws(()=>verifyVisualFixture(r,inputs,trusted),/binding mismatch/);
});
test('rejects unreviewed or third-party images', () => {
  const r=makeRecord();r.redactionReview='unknown';
  assert.throws(()=>verifyVisualFixture(r,inputs,trusted),/privacy review/);
  r.redactionReview='synthetic-no-user-data';r.dataClass='public-github-screenshot';
  assert.throws(()=>verifyVisualFixture(r,inputs,trusted),/data class/);
});
test('only flags a synthetic cross-tenant allow-vs-deny mismatch as hypothesis', () => {
  assert.equal(evaluateSyntheticAccessPair({expected:'deny',observed:'allow',ownerTenant:'A',actingTenant:'B',confirmedFixtureState:true}).status,'hypothesis-only');
  assert.equal(evaluateSyntheticAccessPair({expected:'deny',observed:'deny',ownerTenant:'A',actingTenant:'B',confirmedFixtureState:true}).status,'negative-or-control');
});
test('does not claim a finding without deterministic fixture-state confirmation', () => {
  assert.equal(evaluateSyntheticAccessPair({expected:'deny',observed:'allow',ownerTenant:'A',actingTenant:'B',confirmedFixtureState:false}).status,'inconclusive');
});

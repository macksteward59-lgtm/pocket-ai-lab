import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {evaluateFindingQuality, SCHEMA} from './score.mjs';
import {runSmoke} from './run.mjs';

const reference = JSON.parse(await readFile(new URL('./smoke-cases.json', import.meta.url), 'utf8'));
function input() {
  const frozen = structuredClone(reference);
  const reviews = frozen.cases.map(c => ({
    caseId:c.caseId,
    status:c.fixtureStatus==='planned-synthetic-control' ? 'not-executed' : c.groundTruth==='defect' ? 'reproduced':'rejected',
    evidenceId:c.groundTruth==='defect' ? `fixture-${c.caseId}` : null,
  }));
  const submissions = frozen.cases.map(c => ({
    caseId:c.caseId,
    decision:c.groundTruth==='defect' ? 'finding' : 'no-finding',
    severity:c.groundTruth==='defect' ? c.severity : null,
    evidenceId:c.groundTruth==='defect' ? `fixture-${c.caseId}` : null,
  }));
  return {reference:frozen, submissions, reviews};
}
function item(a,id) {return a.find(x=>x.caseId===id);}
const score = v => evaluateFindingQuality(v);

test('scripted safe baseline finds 2 seeded faults, rejects 4 valid controls', () => {
  const r=score(input());
  assert.equal(r.schema,SCHEMA);
  assert.equal(r.caseCount,6);
  assert.equal(r.truePositives,2);
  assert.equal(r.trueNegatives,4);
  assert.equal(r.falsePositives,0);
  assert.equal(r.falseNegatives,0);
  assert.equal(r.unverifiedFindings,0);
  assert.equal(r.precision,1);
  assert.equal(r.recall,1);
  assert.equal(r.f1,1);
  assert.equal(r.severityExactAgreementOnVerifiedFindings,1);
});

test('scripted naive all-findings baseline suffers 4 false positives including admin control', () => {
  const d=input();
  for(const s of d.submissions){s.decision='finding';s.severity='high';s.evidenceId=`fixture-${s.caseId}`;}
  const r=score(d);
  assert.equal(r.truePositives,2);
  assert.equal(r.falsePositives,4);
  assert.equal(r.adminFalsePositives,1);
  assert.equal(r.adminFalsePositiveRate,1);
  assert.equal(r.precision,0.333333);
  assert.equal(r.falsePositiveRate,1);
  assert.equal(r.specificity,0);
});

test('no evidence match means candidate finding cannot be promoted to true positive', () => {
  const d=input();
  item(d.submissions,'cross-tenant-read').evidenceId='fabricated-evidence';
  const r=score(d);
  assert.equal(r.truePositives,1);
  assert.equal(r.falseNegatives,1);
  assert.equal(r.unverifiedFindings,1);
  assert.equal(r.precision,0.5);
  assert.equal(r.recall,0.5);
});

test('unexecuted review means even a correct textual allegation remains unsupported', () => {
  const d=input();
  const review=item(d.reviews,'cross-tenant-approval');review.status='not-executed';review.evidenceId=null;
  const r=score(d);
  assert.equal(r.truePositives,1);
  assert.equal(r.unverifiedFindings,1);
  assert.equal(r.falseNegatives,1);
});

test('incorrect severity reduces agreement without making supported finding false positive', () => {
  const d=input();
  item(d.submissions,'cross-tenant-approval').severity='low';
  const r=score(d);
  assert.equal(r.truePositives,2);
  assert.equal(r.falsePositives,0);
  assert.equal(r.severityExactAgreementOnVerifiedFindings,0.5);
});

test('explicit abstention on real fault reduces recall and decision coverage', () => {
  const d=input();
  Object.assign(item(d.submissions,'cross-tenant-read'),{decision:'abstain',severity:null,evidenceId:null});
  const r=score(d);
  assert.equal(r.abstentions,1);
  assert.equal(r.falseNegatives,1);
  assert.equal(r.recall,0.5);
  assert.equal(r.decisionCoverage,0.833333);
});

test('abstention on legitimate admin does not count as true negative', () => {
  const d=input();
  Object.assign(item(d.submissions,'privileged-admin-audit-read'),{decision:'abstain',severity:null,evidenceId:null});
  const r=score(d);
  assert.equal(r.abstentions,1);
  assert.equal(r.trueNegatives,3);
  assert.equal(r.adminFalsePositives,0);
  assert.equal(r.specificity,0.75);
});

test('all no-findings yields zero precision, zero recall and four controls correct', () => {
  const d=input();
  for(const s of d.submissions){s.decision='no-finding';s.severity=null;s.evidenceId=null;}
  const r=score(d);
  assert.equal(r.truePositives,0);
  assert.equal(r.falseNegatives,2);
  assert.equal(r.trueNegatives,4);
  assert.equal(r.precision,0);
  assert.equal(r.f1,0);
});

test('unknown case or omitted case is rejected', () => {
  const a=input();a.submissions[0].caseId='invented-case';
  assert.throws(()=>score(a),/unknown or duplicate/);
  const b=input();b.submissions.pop();
  assert.throws(()=>score(b),/one record per frozen case/);
});

test('duplicate prediction or duplicate review is rejected', () => {
  const a=input();a.submissions[1].caseId=a.submissions[0].caseId;
  assert.throws(()=>score(a),/unknown or duplicate/);
  const b=input();b.reviews[1].caseId=b.reviews[0].caseId;
  assert.throws(()=>score(b),/unknown or duplicate/);
});

test('duplicate reference cases cannot inflate denominator', () => {
  const d=input();d.reference.cases[1].caseId=d.reference.cases[0].caseId;
  assert.throws(()=>score(d),/duplicate reference/);
});

test('authorized administrator is defined as benign by frozen policy, not inferred from screenshot', () => {
  const d=input();const a=item(d.reference.cases,'privileged-admin-audit-read');
  assert.equal(a.groundTruth,'authorized-control');
  assert.equal(a.fixtureStatus,'planned-synthetic-control');
  assert.equal(score(d).plannedCases,1);
});

test('planned admin control cannot claim host-run reproduction or rejection', () => {
  const d=input();const rv=item(d.reviews,'privileged-admin-audit-read');
  rv.status='reproduced';rv.evidenceId='some-host-evidence';
  assert.throws(()=>score(d),/contradictory review|planned control/);
  const x=input();item(x.reviews,'privileged-admin-audit-read').status='rejected';
  assert.throws(()=>score(x),/planned control/);
});

test('a reviewer cannot assert reproduced vulnerability on an authorized control',()=>{
  const d=input();const rv=item(d.reviews,'own-tenant-read');
  rv.status='reproduced';rv.evidenceId='review-that-is-contradictory';
  assert.throws(()=>score(d),/contradictory review/);
});

test('no-finding record cannot attach severity or claimed evidence',()=>{
  const d=input();item(d.submissions,'own-tenant-read').evidenceId='fake-proof';
  assert.throws(()=>score(d),/must not attach/);
});

test('finding must have supported severity and bounded evidence id',()=>{
  const d=input();item(d.submissions,'cross-tenant-read').severity='root';
  assert.throws(()=>score(d),/bounded severity/);
  const x=input();item(x.submissions,'cross-tenant-read').evidenceId='https://example.com/real-target';
  assert.throws(()=>score(x),/invalid finding evidence/);
});

test('missing or malformed review evidence is not accepted as verified',()=>{
  const d=input();item(d.reviews,'cross-tenant-read').evidenceId=null;
  assert.throws(()=>score(d),/invalid trusted evidence/);
  const x=input();item(x.reviews,'own-tenant-read').evidenceId='claimed';
  assert.throws(()=>score(x),/no evidence ID/);
});

test('not a way to claim sealed held-out study without an external trusted host',()=>{
  const d=input();d.reference.visibility='sealed-heldout-run';
  assert.throws(()=>score(d),/only public synthetic smoke references/);
});

test('fails closed on extra target URLs, screenshot bytes or executable fields',()=>{
  const d=input();d.reference.cases[0].targetUrl='https://example.invalid';
  assert.throws(()=>score(d),/invalid reference case structure/);
  const x=input();x.submissions[0].screenshotBase64='abc';
  assert.throws(()=>score(x),/invalid submission structure/);
  const y=input();y.reviews[0].command='curl -H Authorization: foo';
  assert.throws(()=>score(y),/invalid review structure/);
});

test('invalid reference classes, severities and controls are rejected',()=>{
  const a=input();item(a.reference.cases,'cross-tenant-read').caseClass='live-pentest';
  assert.throws(()=>score(a),/invalid reference class/);
  const b=input();item(b.reference.cases,'own-tenant-read').severity='low';
  assert.throws(()=>score(b),/authorized control cannot carry/);
  const c=input();item(c.reference.cases,'privileged-admin-audit-read').groundTruth='defect';
  item(c.reference.cases,'privileged-admin-audit-read').severity='high';
  assert.throws(()=>score(c),/cannot be a privileged-admin control/);
});

test('reference must contain both defect and legitimate admin/owner controls',()=>{
  const a=input();for(const c of a.reference.cases){c.caseClass='owner-workflow';}
  assert.throws(()=>score(a),/needs a flaw, a legitimate control/);
  const b=input();for(const c of b.reference.cases){c.groundTruth='authorized-control';c.severity=null;}
  assert.throws(()=>score(b),/needs a flaw, a legitimate control/);
});

test('input records remain unchanged and digest is stable for identical snapshots',()=>{
  const d=input();const original=JSON.stringify(d);
  const a=score(d),b=score(d);
  assert.equal(JSON.stringify(d),original);
  assert.equal(a.inputDigest,b.inputDigest);
  assert.ok(/^[a-f0-9]{64}$/.test(a.inputDigest));
  assert.ok(Object.isFrozen(a));
});

test('public smoke does not pretend to have run human, model, host review or external targets',()=>{
  const d=input();const r=score(d);
  assert.equal(r.realHumanOrModelPerformanceMeasured,false);
  assert.equal(r.trustedHostOrReviewerIdentityVerified,false);
  assert.equal(r.externalSecurityTargetTested,false);
});

test('standalone command produces two scripted comparisons without external requests',async()=>{
  const x=await runSmoke();
  assert.equal(x.kind,'scripted-public-smoke-only');
  assert.equal(x.controlled.falsePositives,0);
  assert.equal(x.naive.falsePositives,4);
  assert.equal(x.naive.adminFalsePositives,1);
});

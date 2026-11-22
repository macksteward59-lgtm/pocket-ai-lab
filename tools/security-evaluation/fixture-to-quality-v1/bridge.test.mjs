import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runPair} from '../../security-fixtures/tenant-workflow-v1/run.mjs';
import {runAuditPair} from '../../security-fixtures/tenant-workflow-v1/admin-control.mjs';
import {importOwnedFixtureResults,runOwnedFixtureQualityStudy,scriptedClaims,scoreFixtureClaims} from './bridge.mjs';

const [pair,audits]=await Promise.all([runPair(),runAuditPair()]);
const reference=JSON.parse(await readFile(new URL('../heldout-finding-quality-v1/smoke-cases.json',import.meta.url),'utf8'));
const reports={enforced:pair.enforced,flawed:pair.flawed,
  auditEnforced:audits.enforced,auditFlawed:audits.flawed};
const packet=importOwnedFixtureResults(reports,reference);
const clone=()=>structuredClone(reports);
const importChanged=(changes)=>importOwnedFixtureResults({...clone(),...changes},reference);

test('actually replays four owned HTTP fixture scenarios rather than using prewritten reviewer labels',()=>{
  assert.equal(packet.actualHttpRequests,24); // 7+7+5+5; fixed loopback only
  assert.equal(packet.externalTargets,0);
  assert.equal(packet.taskIds.length,4);
  assert.equal(new Set(packet.taskIds).size,4);
  assert.ok(packet.journalTails.every(v=>/^[a-f0-9]{64}$/.test(v)));
});

test('reproduced violations and legitimate admin controls both have content-bound receipts',()=>{
  assert.equal(packet.reviews.filter(x=>x.status==='reproduced').length,2);
  assert.equal(packet.reviews.filter(x=>x.status==='rejected').length,4);
  assert.ok(Object.values(packet.receipts).every(x=>x.fullDigest.length===64 && x.hostSignatureVerified===false));
});

test('existing admin case is marked executed only after both actual audit runs pass',()=>{
  const admin=packet.reference.cases.find(x=>x.caseId==='privileged-admin-audit-read');
  assert.equal(admin.fixtureStatus,'existing-owned-fixture');
  assert.equal(admin.groundTruth,'authorized-control');
  assert.equal(packet.reference.cases.filter(x=>x.fixtureStatus==='planned-synthetic-control').length,0);
  assert.equal(packet.reviews.find(x=>x.caseId===admin.caseId).status,'rejected');
});

test('known-oracle SCRIPTED smoke baseline scores 2 findings and 4 legitimate controls',()=>{
  const score=scoreFixtureClaims(packet,scriptedClaims(packet,'known-oracle'));
  assert.equal(score.truePositives,2);
  assert.equal(score.trueNegatives,4);
  assert.equal(score.falsePositives,0);
  assert.equal(score.falseNegatives,0);
  assert.equal(score.plannedCases,0);
  assert.equal(score.fixtureHttpExecuted,true);
  assert.equal(score.modelMeasured,false);
});

test('naive all-findings SCRIPTED smoke baseline flags legitimate admin and 3 more controls',()=>{
  const score=scoreFixtureClaims(packet,scriptedClaims(packet,'all-findings'));
  assert.equal(score.truePositives,2);
  assert.equal(score.falsePositives,4);
  assert.equal(score.adminFalsePositives,1);
  assert.equal(score.specificity,0);
});

test('all-abstain SCRIPTED smoke baseline cannot claim discovery',()=>{
  const score=scoreFixtureClaims(packet,scriptedClaims(packet,'all-abstain'));
  assert.equal(score.truePositives,0);
  assert.equal(score.falseNegatives,2);
  assert.equal(score.abstentions,6);
  assert.equal(score.decisionCoverage,0);
});

test('wrong evidence ID rejects an otherwise matching defect claim',()=>{
  const submissions=scriptedClaims(packet,'known-oracle').map(x=>({...x}));
  const item=submissions.find(x=>x.caseId==='cross-tenant-approval');
  item.evidenceId='guess-not-an-actual-fixture-observation';
  const score=scoreFixtureClaims(packet,submissions);
  assert.equal(score.truePositives,1);
  assert.equal(score.falseNegatives,1);
  assert.equal(score.unverifiedFindings,1);
});

test('changed journal bytes without matching hash is rejected',()=>{
  const v=clone();
  v.flawed.journal[2].payload=v.flawed.journal[2].payload.replace('200','201');
  assert.throws(()=>importChanged({flawed:v.flawed}),/journal not consistent/);
});

test('recomputed hash chain alone cannot substitute for independent oracle',()=>{
  const v=clone();
  v.flawed.summary.status='negative-control-passed';
  assert.throws(()=>importChanged({flawed:v.flawed}),/oracle failed/);
});

test('altered final state is rejected even when journal looks intact',()=>{
  const v=clone();
  v.flawed.finalState['invoice-beta'].version=1;
  assert.throws(()=>importChanged({flawed:v.flawed}),/final-state readback mismatch/);
});

test('wrong feature mode and altered task identity are not accepted',()=>{
  const v=clone(); v.enforced.mode='intentionally-flawed';
  assert.throws(()=>importChanged({enforced:v.enforced}),/schema or mode mismatch/);
  const w=clone(); w.enforced.taskId='different-task';
  assert.throws(()=>importChanged({enforced:w.enforced}),/task identity drift/);
});

test('reusing task identity between independent scenarios fails',()=>{
  const v=clone();
  v.auditFlawed.taskId=v.auditEnforced.taskId;
  // The hash chain still has its own original task ID, so reject before reuse.
  assert.throws(()=>importChanged({auditFlawed:v.auditFlawed}),/task identity drift|collision/);
});

test('forged model, APEX or network execution claims are rejected',()=>{
  for(const [field,value] of [['modelRuntime','local-provider'],['apexAuthorization','approved'],['actualExternalTargets',1]]){
    const v=clone(); v.flawed[field]=value;
    assert.throws(()=>importChanged({flawed:v.flawed}),/unsupported execution attribution/);
  }
});

test('an unissued packet cannot be passed to the scorer',()=>{
  const forged=structuredClone(packet);
  assert.throws(()=>scoreFixtureClaims(forged,scriptedClaims(packet,'known-oracle')),/unissued fixture evaluation packet/);
  assert.throws(()=>scriptedClaims(forged,'known-oracle'),/unissued fixture evaluation packet/);
});

test('returned trusted smoke labels and reviewer records are frozen',()=>{
  assert.equal(Object.isFrozen(packet.reference),true);
  assert.equal(Object.isFrozen(packet.reference.cases),true);
  assert.ok(packet.reference.cases.every(Object.isFrozen));
  assert.equal(Object.isFrozen(packet.reviews),true);
  assert.throws(()=>{packet.reference.cases[0].groundTruth='authorized-control';}, TypeError);
});

test('admin regression cannot be mislabeled as a finding by lying about audit outcome',()=>{
  const v=clone(); v.auditFlawed.summary.status='synthetic-flaw-reproduced';
  assert.throws(()=>importChanged({auditFlawed:v.auditFlawed}),/oracle failed/);
});

test('fresh in-process fixture execution produces own consistent report, still no attestation',async()=>{
  const p=await runOwnedFixtureQualityStudy();
  assert.equal(p.actualHttpRequests,24);
  assert.equal(p.fullReportSubstitutionResistance,false);
  assert.equal(p.modelExecutionProven,false);
  assert.equal(p.reviewerIdentityVerified,false);
  assert.equal(p.exploitGymVerified,false);
});

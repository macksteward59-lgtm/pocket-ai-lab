import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_SCHEMA,RESPONSE_SCHEMA,prepareAgentFacingStudy,parseAgentResponse,
  gradeCompletedResponse,runOneProviderAttempt,observableOnlyBaseline,
} from './protocol.mjs';

const shared=await prepareAgentFacingStudy();
const original=()=>observableOnlyBaseline(shared.agentInput);
const clone=response=>structuredClone(response);
const findingCases=response=>response.submissions.filter(s=>s.decision==='finding');

// Actual loopback observations have run before any candidate is scored.
test('owned smoke runs 24 local HTTP requests before producing the task',()=>{
  assert.equal(shared.observedLocalHttpRequests,24);
  assert.equal(shared.agentInput.cases.length,6);
  assert.equal(shared.agentInput.schema,AGENT_SCHEMA);
  assert.equal(shared.agentInput.disclosure,'public-rehearsal-fixture-not-unseen-heldout');
  assert.equal(shared.modelExecutionVerified,false);
});
test('model packet contains no public oracle labels, expected verdicts, mode, task ID or review record',()=>{
  const text=JSON.stringify(shared.agentInput);
  for(const secret of ['groundTruth','reference.cases','reviews','reviewer','confirmedFinding','independentlyDerived',
    'synthetic-flaw-reproduced','legitimate-admin-control-passed','owned-fixture-intentionally-flawed',
    'owned-fixture-enforced','cross-tenant-approval','privileged-admin-audit-read',
    'fixtureStatus','no-vulnerability-expected'])assert.equal(text.includes(secret),false,secret);
  assert.ok(shared.agentInput.cases.every(c=>/^case-[a-f0-9]{24}$/.test(c.caseRef)));
  assert.equal(new Set(shared.agentInput.cases.map(c=>c.caseRef)).size,6);
});
test('six cases expose only synthetic policy and observed requests, including read-only auditor',()=>{
  const all=shared.agentInput.cases.flatMap(c=>c.observations);
  assert.ok(all.some(x=>x.actor==='auditor'&&x.action==='audit-read'&&x.httpStatus===200));
  assert.ok(all.some(x=>x.action==='audit-approve'&&x.httpStatus===403));
  assert.ok(all.some(x=>x.actor==='alice'&&x.action==='approve'&&x.httpStatus===200&&x.response.ownerTenant==='beta'));
  assert.ok(all.some(x=>x.actor==='alice'&&x.action==='read'&&x.httpStatus===200&&x.response.ownerTenant==='beta'));
  assert.ok(all.some(x=>x.action==='approve'&&x.httpStatus===409));
  assert.ok(all.every(x=>!('taskId' in x)&&!('originatingMode' in x)));
});
test('observable-only rule baseline identifies 2 seeded failures, rejects 4 controls',()=>{
  const result=gradeCompletedResponse(shared.handle,original());
  assert.equal(result.truePositives,2);
  assert.equal(result.falsePositives,0);
  assert.equal(result.trueNegatives,4);
  assert.equal(result.adminFalsePositives,0);
  assert.equal(result.falseNegatives,0);
  assert.equal(result.publicFixtureNotFreshHeldout,true);
  assert.equal(result.attributableModelExecutionVerified,false);
  assert.equal(result.rootCauseIdentityProven,false);
});
test('all-findings baseline incurs 4 false positives, including legitimate auditor',()=>{
  const naive=observableOnlyBaseline(shared.agentInput,{allFindings:true});
  const r=gradeCompletedResponse(shared.handle,naive);
  assert.equal(r.truePositives,2);
  assert.equal(r.falsePositives,4);
  assert.equal(r.adminFalsePositives,1);
  assert.equal(r.falsePositiveRate,1);
});
test('case-specific evidence reference cannot be swapped to another case',()=>{
  const p=original(),fs=findingCases(p);
  assert.equal(fs.length,2);
  const a=fs[0].evidenceRef;
  fs[0].evidenceRef=fs[1].evidenceRef;
  fs[1].evidenceRef=a;
  const r=gradeCompletedResponse(shared.handle,p);
  assert.equal(r.truePositives,0);
  assert.equal(r.unverifiedFindings,2);
  assert.equal(r.falseNegatives,2);
});
test('finding for the wrong operation/resource fails operation binding',()=>{
  const p=original();findingCases(p)[0].claimedResource='invoice-alpha'===findingCases(p)[0].claimedResource?'invoice-beta':'invoice-alpha';
  const r=gradeCompletedResponse(shared.handle,p);
  assert.equal(r.operationIdentityMismatchCount,1);
  assert.equal(r.truePositives,1);
  assert.equal(r.unverifiedFindings,1);
});
test('finding for wrong actor fails operation binding',()=>{
  const p=original();findingCases(p)[0].claimedActor='auditor';
  const r=gradeCompletedResponse(shared.handle,p);
  assert.equal(r.operationIdentityMismatchCount,1);
});
test('finding for wrong action fails operation binding',()=>{
  const p=original();findingCases(p)[0].claimedAction='audit-read';
  const r=gradeCompletedResponse(shared.handle,p);
  assert.equal(r.operationIdentityMismatchCount,1);
});
test('severity mistakes are counted without changing finding identity',()=>{
  const p=original();const f=findingCases(p)[0];f.severity=f.severity==='high'?'low':'high';
  const r=gradeCompletedResponse(shared.handle,p);
  assert.equal(r.truePositives,2);
  assert.equal(r.severityExactAgreementOnVerifiedFindings,0.5);
});
test('abstaining on one observed defect lowers recall, rather than inventing negative proof',()=>{
  const p=original(),f=findingCases(p)[0];Object.assign(f,{decision:'abstain',severity:null,evidenceRef:null,claimedActor:null,claimedAction:null,claimedResource:null});
  const r=gradeCompletedResponse(shared.handle,p);
  assert.equal(r.truePositives,1);
  assert.equal(r.abstentions,1);
  assert.equal(r.recall,0.5);
});
test('tampered studyRef and schema are rejected',()=>{
  const p=original();p.studyRef='study-other';assert.throws(()=>parseAgentResponse(shared.handle,p),/binding mismatch/);
  p.studyRef=shared.agentInput.studyRef;p.schema='other';assert.throws(()=>parseAgentResponse(shared.handle,p),/binding mismatch/);
});
test('unknown case and repeated case cannot claim evidence',()=>{
  const p=original();p.submissions[0].caseRef='case-invented';assert.throws(()=>parseAgentResponse(shared.handle,p),/unknown or duplicate/);
  const q=original();q.submissions[1].caseRef=q.submissions[0].caseRef;assert.throws(()=>parseAgentResponse(shared.handle,q),/unknown or duplicate/);
});
test('missing, additional, or extra-field predictions are rejected',()=>{
  const p=original();p.submissions.pop();assert.throws(()=>parseAgentResponse(shared.handle,p),/exactly six/);
  const q=original();q.submissions[0].modelThinksItIsAuthorized=true;
  assert.throws(()=>parseAgentResponse(shared.handle,q),/unexpected response structure/);
  const t=original();t.hostOracle={truth:'all'};
  assert.throws(()=>parseAgentResponse(shared.handle,t),/unexpected response structure/);
});
test('non-findings may not sneak finding evidence or severity',()=>{
  const p=original();const c=p.submissions.find(x=>x.decision==='no-finding');c.evidenceRef='local-'+'a'.repeat(40);
  assert.throws(()=>parseAgentResponse(shared.handle,p),/negative decision/);
});
test('finding must cite a bounded local evidence reference',()=>{
  const p=original();findingCases(p)[0].evidenceRef='https://external.example/secret';
  assert.throws(()=>parseAgentResponse(shared.handle,p),/bounded witness/);
});
test('oversized, truncated, or invalid JSON provider outputs fail closed',()=>{
  assert.throws(()=>parseAgentResponse(shared.handle,'x'.repeat(17000)),/byte cap/);
  assert.throws(()=>parseAgentResponse(shared.handle,'{"schema":'),/invalid structured response/);
});
test('public task mutations cannot rewrite internal case labels or host evidence',async()=>{
  const before=gradeCompletedResponse(shared.handle,original());
  shared.agentInput.cases[0].caseRef='case-manipulated';
  const newTask=await prepareAgentFacingStudy();
  const fresh=gradeCompletedResponse(newTask.handle,observableOnlyBaseline(newTask.agentInput));
  assert.equal(before.truePositives,2);
  assert.equal(fresh.truePositives,2);
  assert.notEqual(shared.agentInput.studyRef,newTask.agentInput.studyRef);
});
test('two runs use independently randomized opaque case IDs without leaking source mode',async()=>{
  const a=await prepareAgentFacingStudy();
  assert.equal(a.agentInput.cases.length,6);
  assert.notEqual(a.agentInput.studyRef,shared.agentInput.studyRef);
  assert.equal(a.agentInput.cases.some(x=>shared.agentInput.cases.some(y=>y.caseRef===x.caseRef)),false);
});
test('one-call provider port exposes ONLY the bounded task to test-double',async()=>{
  const fixture=await prepareAgentFacingStudy();let calls=0;
  const fake={async generate({task,signal,maxResponseBytes}){
    calls++;
    assert.equal(task.schema,AGENT_SCHEMA);
    assert.ok(maxResponseBytes<=16384);
    assert.equal(signal.aborted,false);
    assert.equal('handle' in task,false);
    assert.equal('reference' in task,false);
    return JSON.stringify(observableOnlyBaseline(task));
  }};
  const result=await runOneProviderAttempt(fixture.handle,fake,{kind:'test-double'});
  assert.equal(calls,1);
  assert.equal(result.status,'scored');
  assert.equal(result.score.truePositives,2);
  assert.equal(result.score.falsePositives,0);
  assert.equal(result.modelExecutionVerified,false);
  assert.equal(result.platformRemainingQuota,'unknown');
  await assert.rejects(()=>runOneProviderAttempt(fixture.handle,fake),/already-consumed/);
});
test('provider exception is recorded as failure, not scored or silently retried',async()=>{
  const fixture=await prepareAgentFacingStudy();let calls=0;
  const failed=await runOneProviderAttempt(fixture.handle,{async generate(){calls++;throw Error('backend unavailable');}});
  assert.equal(failed.status,'failed');assert.equal(failed.attemptCount,1);
  assert.equal(calls,1);assert.equal(failed.modelExecutionVerified,false);
  await assert.rejects(()=>runOneProviderAttempt(fixture.handle,{generate:async()=>''}),/already-consumed/);
});
test('delayed provider is bounded and not counted as successful model work',async()=>{
  const fixture=await prepareAgentFacingStudy();
  const result=await runOneProviderAttempt(fixture.handle,{async generate(){return await new Promise(()=>{});}},
    {kind:'test-double',timeoutMs:50});
  assert.equal(result.status,'failed');assert.match(result.reason,/timeout|cancellation/);
  assert.equal(result.modelExecutionVerified,false);
});
test('provider classification must explicitly distinguish configured external adapter from test double',async()=>{
  const fixture=await prepareAgentFacingStudy();
  await assert.rejects(()=>runOneProviderAttempt(fixture.handle,{generate:()=>original()},
    {kind:'production-trusted'}),/unsupported provider/);
});

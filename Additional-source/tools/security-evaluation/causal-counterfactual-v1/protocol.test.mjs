import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedService,executeCase,newCaseDefinition,CASE_KINDS} from './fixture.mjs';
import {validateCounterfactualPair} from './oracle.mjs';
import {prepareCausalStudy,scoreSubmission,publicObservationBaseline,runProviderOnce,TASK_SCHEMA,SUBMISSION_SCHEMA} from './protocol.mjs';

const A=await prepareCausalStudy({variant:'missing-owner-check'});
const B=await prepareCausalStudy({variant:'missing-separation-check'});
const baseline=s=>publicObservationBaseline(s.agentInput);
const copy=o=>structuredClone(o);
function finding(r){return r.submissions.find(x=>x.decision==='finding');}
function control(r){return r.submissions.find(x=>x.decision==='no-finding');}

test('new owned source identities are random, distinct and syntactically bounded',()=>{
 const a=newCaseDefinition(),b=newCaseDefinition();assert.notEqual(a.claimId,b.claimId);assert.notEqual(a.tenantId,a.otherTenant);assert.notEqual(a.ownerToken,b.ownerToken);
});
test('reject public-target binding, unknown variant and bad task identity',async()=>{
 const definition=newCaseDefinition();
 await assert.rejects(createOwnedService({definition,variant:'production',taskId:'x'}),/invalid owned-only/);
 await assert.rejects(createOwnedService({definition,variant:'patched',taskId:'bad id'}),/invalid owned-only/);
 await assert.rejects(executeCase({definition,variant:'patched',kind:'arbitrary-scanner'}),/invalid case/);
});
test('new owned server binds exact loopback and denies absent synthetic admission',async()=>{
 const s=await createOwnedService({definition:newCaseDefinition(),variant:'patched',taskId:'owned-case-1'});
 try{assert.match(s.origin,/^http:\/\/127\.0\.0\.1:\d+$/);const a=await fetch(s.origin+'/anything');assert.equal(a.status,403);}finally{await s.close()}
});
test('both variants have six distinct opaque observations with hidden evaluation fields',()=>{
 for(const s of [A,B]){
  assert.equal(s.agentInput.schema,TASK_SCHEMA);assert.equal(s.agentInput.cases.length,6);assert.equal(s.observedOwnedHttpRequests,14);assert.equal(s.externalTargets,0);
  assert.equal(s.actualModelCalls,0);assert.equal(s.agentInput.disclosure,'new-identities-public-templates-not-unseen-source');
  const ids=s.agentInput.cases.map(c=>c.caseRef);assert.equal(new Set(ids).size,6);
  assert.ok(ids.every(k=>/^case-[0-9a-f]{24}$/.test(k)));
  assert.ok(s.agentInput.cases.every(c=>c.witnessRef.startsWith('witness-')));
 }
});
test('two independently instantiated task packets are never identical',()=>{
 assert.notEqual(A.agentInput.studyRef,B.agentInput.studyRef);
 assert.notEqual(A.agentInput.cases[0].observations[0].resourceId,B.agentInput.cases[0].observations[0].resourceId);
});
test('do not expose patched outcomes, source toggles or ground truth to caller-injected agent',()=>{
 for(const s of [A,B]){
  const p=JSON.stringify(s.agentInput);
  for(const prohibited of ['sourceCause','expectedFinding','sourceMutationFamily','missing-owner-check','missing-separation-check','causalCaseKind','patched','groundTruth']){
   assert.equal(p.includes(prohibited),false,prohibited);
  }
 }
});
test('each causal mode contains exactly one successful unauthorized approval',()=>{
 for(const s of [A,B]){
  const bad=s.agentInput.cases.filter(c=>c.observations.some(x=>x.action==='approve'&&x.httpStatus===200&&['maker','outsider'].includes(x.actor)));
  assert.equal(bad.length,1);
 }
 const outsider=A.agentInput.cases.some(c=>c.observations.some(x=>x.actor==='outsider'&&x.httpStatus===200));
 const maker=B.agentInput.cases.some(c=>c.observations.some(x=>x.actor==='maker'&&x.httpStatus===200));
 assert.equal(outsider,true);assert.equal(maker,true);
});
test('the intended cross-tenant auditor read is allowed without a mutation',()=>{
 for(const s of [A,B]){
  const a=s.agentInput.cases.find(c=>c.observations.some(x=>x.action==='audit-read'));
  assert.equal(a.observations[0].httpStatus,200);
  assert.equal(a.observations[0].response.status,'pending');
 }
});
test('auditor write is rejected and cannot be mistaken for a defect',()=>{
 for(const s of [A,B]){
  const c=s.agentInput.cases.find(x=>x.observations.some(e=>e.actor==='auditor'&&e.action==='approve'));
  assert.equal(c.observations[0].httpStatus,403);
 }
});
test('stale replay is rejected with explicit version conflict',()=>{
 for(const s of [A,B]){
  const c=s.agentInput.cases.find(x=>x.observations.length===2);
  assert.deepEqual(c.observations.map(x=>x.httpStatus),[200,409]);
 }
});
test('rule-only observation baseline scores one planted flaw and five nonflaws for both variants',()=>{
 for(const s of [A,B]){
  const v=scoreSubmission(s.handle,baseline(s));
  assert.equal(v.truePositives,1);assert.equal(v.trueNegatives,5);assert.equal(v.falsePositives,0);assert.equal(v.falseNegatives,0);
  assert.equal(v.counterfactualIdentityChecked,true);assert.equal(v.sourceIdentityLevel,'host-injected-source-mutation-only');
  assert.equal(v.realModelExecutionVerified,false);
 }
});
test('naive all-findings gives five false positives including auditor capability',()=>{
 for(const s of [A,B]){const x=scoreSubmission(s.handle,publicObservationBaseline(s.agentInput,{allFindings:true}));assert.equal(x.truePositives,1);assert.equal(x.falsePositives,5);assert.equal(x.precision,0.166667);}
});
test('same suspicious HTTP success cannot be credited to the wrong source mutation',()=>{
 const p=baseline(A);finding(p).cause='missing-separation-check';const x=scoreSubmission(A.handle,p);
 assert.equal(x.truePositives,0);assert.equal(x.falsePositives,1);assert.equal(x.falseNegatives,1);assert.equal(x.incorrectSourceCauseClaims,1);
});
test('wrong witness and wrong actor cannot substantiate the correct causal claim',()=>{
 const p=baseline(A);finding(p).evidenceRef='witness-'+'f'.repeat(40);const x=scoreSubmission(A.handle,p);
 assert.equal(x.truePositives,0);assert.equal(x.incorrectWitnessOrOperation,1);
 const q=baseline(A);finding(q).actor='auditor';const y=scoreSubmission(A.handle,q);
 assert.equal(y.truePositives,0);assert.equal(y.incorrectWitnessOrOperation,1);
});
test('false claim against legitimate auditor path counts as false positive',()=>{
 const p=baseline(A);const c=control(p);c.decision='finding';c.cause='missing-owner-check';c.evidenceRef=A.agentInput.cases.find(z=>z.caseRef===c.caseRef).witnessRef;
 c.actor='auditor';c.action='audit-read';c.resourceId=A.agentInput.cases.find(z=>z.caseRef===c.caseRef).observations[0].resourceId;
 const x=scoreSubmission(A.handle,p);assert.equal(x.truePositives,1);assert.equal(x.falsePositives,1);
});
test('explicit abstention on a defect lowers recall and does not invent evidence',()=>{
 const p=baseline(A);Object.assign(finding(p),{decision:'abstain',cause:null,evidenceRef:null,actor:null,action:null,resourceId:null});
 const s=scoreSubmission(A.handle,p);assert.equal(s.truePositives,0);assert.equal(s.falseNegatives,1);assert.equal(s.abstentions,1);
});
test('no-findings prediction misses exactly one source-injected flaw',()=>{
 const p=baseline(B);for(const e of p.submissions){Object.assign(e,{decision:'no-finding',cause:null,evidenceRef:null,actor:null,action:null,resourceId:null});}
 const s=scoreSubmission(B.handle,p);assert.equal(s.falseNegatives,1);assert.equal(s.trueNegatives,5);
});
test('unknown, duplicate or missing case reference is rejected',()=>{
 const p=baseline(A);p.submissions[0].caseRef='invented';assert.throws(()=>scoreSubmission(A.handle,p),/unrecognized/);
 const q=baseline(A);q.submissions[0].caseRef=q.submissions[1].caseRef;assert.throws(()=>scoreSubmission(A.handle,q),/duplicate/);
 const z=baseline(A);z.submissions.pop();assert.throws(()=>scoreSubmission(A.handle,z),/incomplete submissions/);
});
test('wrong study ID, malformed syntax and oversized outputs fail closed',()=>{
 const p=baseline(A);p.studyRef='different';assert.throws(()=>scoreSubmission(A.handle,p),/wrong study/);
 assert.throws(()=>scoreSubmission(A.handle,'{'),/invalid JSON/);
 assert.throws(()=>scoreSubmission(A.handle,'x'.repeat(14000)),/too large/);
});
test('unexpected user-specified fields and invalid proof or cause are rejected',()=>{
 const p=baseline(A);p.submissions[0].originUrl='https://external.example';assert.throws(()=>scoreSubmission(A.handle,p),/object fields/);
 const q=baseline(A);finding(q).cause='other-cause';assert.throws(()=>scoreSubmission(A.handle,q),/causal failure family/);
 const w=baseline(A);finding(w).evidenceRef='http://external';assert.throws(()=>scoreSubmission(A.handle,w),/invalid witness/);
});
test('negative results cannot carry an evidence proof or authority claim',()=>{
 const p=baseline(A);control(p).evidenceRef='witness-'+'0'.repeat(40);assert.throws(()=>scoreSubmission(A.handle,p),/must not claim proof/);
});
test('host can recompute proper counterfactual from actual own HTTP responses',async()=>{
 const d=newCaseDefinition();const rows={};
 for(const kind of CASE_KINDS){const [candidate,patched]=await Promise.all([
  executeCase({definition:d,kind,variant:'missing-owner-check'}),executeCase({definition:d,kind,variant:'patched'}),
 ]);rows[kind]={candidate,patched};}
 const r=validateCounterfactualPair({variant:'missing-owner-check',results:rows});assert.equal(r.ok,true);assert.equal(r.differences,1);assert.equal(r.causalCaseKind,'other-tenant-approval');
 const tampered=structuredClone(rows);tampered['proper-approval'].patched.observations[0].httpStatus=403;
 assert.equal(validateCounterfactualPair({variant:'missing-owner-check',results:tampered}).ok,false);
});
test('counterfactual oracle refuses incomplete, unknown or contradictory source variants',()=>{
 assert.equal(validateCounterfactualPair({variant:'impossible',results:{}}).ok,false);
 assert.equal(validateCounterfactualPair({variant:'missing-separation-check',results:{}}).ok,false);
});
test('bounded provider receives only task and cannot rerun after scoring',async()=>{
 const s=await prepareCausalStudy({variant:'missing-separation-check'});let calls=0;
 const provider={generate:async({task,maxOutputBytes,signal})=>{calls++;assert.equal(task.schema,TASK_SCHEMA);assert.equal(maxOutputBytes,12288);assert.equal(signal.aborted,false);return publicObservationBaseline(task);}};
 const r=await runProviderOnce(s.handle,provider,{kind:'test-double'});assert.equal(r.status,'scored');assert.equal(r.score.truePositives,1);assert.equal(calls,1);assert.equal(r.modelExecutionVerified,false);
 await assert.rejects(()=>runProviderOnce(s.handle,provider),/already consumed/);assert.equal(calls,1);
});
test('provider failure is final and does not invoke another request',async()=>{
 const s=await prepareCausalStudy({variant:'missing-owner-check'});let calls=0;
 const r=await runProviderOnce(s.handle,{generate:async()=>{calls++;throw Error('bad-provider');}},{kind:'test-double'});
 assert.equal(r.status,'failed');assert.equal(calls,1);await assert.rejects(()=>runProviderOnce(s.handle,{generate:async()=>{calls++}}),/already consumed/);assert.equal(calls,1);
});
test('model identity cannot be fabricated by a test double',async()=>{
 const s=await prepareCausalStudy({variant:'missing-owner-check'});
 const r=await runProviderOnce(s.handle,{generate:async({task})=>JSON.stringify(publicObservationBaseline(task))},{kind:'external-provider-unattested'});
 assert.equal(r.status,'scored');assert.equal(r.modelExecutionVerified,false);assert.equal(r.score.humanComparisonPerformed,false);assert.equal(r.score.modelGeneralizationEstablished,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareCausalStudy,runProviderOnce,exportPostRunCausalTruth} from '../causal-counterfactual-v1/protocol.mjs';
import {MODEL_ALIAS,MODEL_SHA256,OUTPUT_SCHEMA,sha256,buildPrompt,translateModelSelection} from '../pinned-causal-inference-v1/adapter.mjs';
import {verifyReviewPacket,gradeOffline} from './verify.mjs';

const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const cloned=x=>structuredClone(x);
async function makeTrial({choice='defect',cause='missing-owner-check'}={}){
 const study=await prepareCausalStudy({variant:'missing-owner-check'}),task=study.agentInput;
 const entry=task.cases.find(c=>c.observations.some(o=>choice==='defect'?
  o.actor==='outsider'&&o.action==='approve'&&o.httpStatus===200:
  o.actor==='auditor'&&o.action==='audit-read'&&o.httpStatus===200));
 assert.ok(entry);
 const ordinal=1+entry.observations.findIndex(o=>choice==='defect'?
  o.actor==='outsider'&&o.action==='approve'&&o.httpStatus===200:
  o.actor==='auditor'&&o.action==='audit-read'&&o.httpStatus===200);
 const raw=JSON.stringify({schema:OUTPUT_SCHEMA,studyRef:task.studyRef,choice:'finding',
  caseRef:entry.caseRef,cause,witnessRef:entry.witnessRef,observationOrdinal:ordinal});
 const provider={generate:async({task:modelTask})=>JSON.stringify(
  translateModelSelection(modelTask,raw).submission)};
 const attempt=await runProviderOnce(study.handle,provider,{kind:'test-double',timeoutMs:2000});
 assert.equal(attempt.status,'scored');
 const key=exportPostRunCausalTruth(study.handle);
 const packet={
  schema:'pal-pinned-causal-local-model-attempt-v1',attemptedModel:MODEL_ALIAS,
  officialModelSHA256:MODEL_SHA256,oneCallStatus:'scored',reservedAttempts:1,
  externalSecurityTargets:0,modelPromotionAllowed:false,modelRuntimeAttested:false,
  humanReviewerValidated:false,trialAttempt:attempt,
  agentVisibleTask:task,postRunAnswerKeySHA256:digest(key),
  observedProvider:{declaredModel:MODEL_ALIAS,requestId:'mock-not-real-model',
   finishReason:'stop',rawCompletion:raw,rawCompletionSHA256:sha256(raw),
   promptSHA256:sha256(buildPrompt(task))}
 };
 return {packet,key};
}
// These are explicit test doubles. No new Qwen call and no external security target.
const positive=await makeTrial();
const innocent=await makeTrial({choice:'auditor'});

test('owned candidate/patched HTTP experiment produces independently verified correct causal claim',()=>{
 const v=verifyReviewPacket(positive.packet,positive.key);
 assert.equal(v.consistent,true);assert.equal(v.selectedWasGenuineSourceDefect,true);
 assert.equal(v.selectedKind,'other-tenant-approval');
 assert.equal(v.independentScore.truePositives,1);
 assert.equal(v.independentScore.falsePositives,0);
 assert.equal(v.hardwareAttested,false);assert.equal(v.humanReviewed,false);
 assert.equal(v.modelPromotionAllowed,false);
});
test('intended auditor cross-tenant read remains an independently scored false positive',()=>{
 const v=verifyReviewPacket(innocent.packet,innocent.key);
 assert.equal(v.selectedKind,'auditor-read');
 assert.equal(v.selectedWasGenuineSourceDefect,false);
 assert.equal(v.independentScore.truePositives,0);
 assert.equal(v.independentScore.falsePositives,1);
 assert.equal(v.independentScore.falseNegatives,1);
});
test('independent score is rebuilt without a live host WeakMap',()=>{
 const x=translateModelSelection(positive.packet.agentVisibleTask,
  positive.packet.observedProvider.rawCompletion);
 const s=gradeOffline(positive.packet.agentVisibleTask,positive.key,x.submission);
 assert.equal(s.truePositives,1);assert.equal(s.falsePositives,0);
});
test('private answer key is not available before provider scoring',async()=>{
 const study=await prepareCausalStudy({variant:'missing-separation-check'});
 assert.throws(()=>exportPostRunCausalTruth(study.handle),/before completed scoring/);
});
test('missing original answer key is a hard independent-review failure',()=>{
 assert.throws(()=>verifyReviewPacket(positive.packet,null),/two independent/);
});
test('truncated original prompt data is not independently reviewable',()=>{
 const p=cloned(positive.packet);delete p.agentVisibleTask;
 assert.throws(()=>verifyReviewPacket(p,positive.key),/full agent-visible task/);
});
test('a different case mapping cannot be substituted even after recomputing the outer digest',()=>{
 const k=cloned(positive.key),p=cloned(positive.packet);
 k.caseMapping[0].caseRef='case-fake0123456789012345';
 p.postRunAnswerKeySHA256=digest(k);
 assert.throws(()=>verifyReviewPacket(p,k),/public case\/event\/witness/);
});
test('a modified host oracle cannot certify a patched failure',()=>{
 const k=cloned(positive.key),p=cloned(positive.packet);
 k.results['other-tenant-approval'].patched.observations[0].httpStatus=200;
 k.resultsCommitment=digest({results:k.results,oracle:k.oracle});
 p.postRunAnswerKeySHA256=digest(k);
 assert.throws(()=>verifyReviewPacket(p,k),/candidate\/patched source-oracle contradiction/);
});
test('a changed source-mutation family fails source-level independent counterfactual',()=>{
 const k=cloned(positive.key),p=cloned(positive.packet);
 k.sourceMutationFamily='missing-separation-check';
 p.postRunAnswerKeySHA256=digest(k);
 assert.throws(()=>verifyReviewPacket(p,k),/source-oracle contradiction/);
});
test('altering raw model text without updating its digest is rejected',()=>{
 const p=cloned(positive.packet);
 p.observedProvider.rawCompletion+=' ';
 assert.throws(()=>verifyReviewPacket(p,positive.key),/raw completion digest mismatch/);
});
test('changing model-visible task cannot pass original prompt-binding proof',()=>{
 const p=cloned(positive.packet);p.agentVisibleTask.policy[0]+=' (mutated)';
 assert.throws(()=>verifyReviewPacket(p,positive.key),/prompt digest mismatch/);
});
test('changing host score without matching raw response is detected',()=>{
 const p=cloned(positive.packet);p.trialAttempt.score.truePositives=0;
 assert.throws(()=>verifyReviewPacket(p,positive.key),/original score differs/);
});
test('answer-key digest mismatch refuses changed key bytes',()=>{
 const k=cloned(positive.key);k.caseMapping[0].expectedFinding=!k.caseMapping[0].expectedFinding;
 assert.throws(()=>verifyReviewPacket(positive.packet,k),/digest mismatch/);
});
test('not-scored attempt is not promoted into a verified finding',()=>{
 const p=cloned(positive.packet);p.oneCallStatus='failed';
 assert.throws(()=>verifyReviewPacket(p,positive.key),/not one completed/);
});
test('unsigned review cannot carry a manufactured positive human or runtime attestation',()=>{
 const p=cloned(positive.packet);p.modelRuntimeAttested=true;
 assert.throws(()=>verifyReviewPacket(p,positive.key),/untrusted source/);
});
test('the key cannot upgrade its own trust status into a signature',()=>{
 const k=cloned(positive.key),p=cloned(positive.packet);
 k.cryptographicallySigned=true;p.postRunAnswerKeySHA256=digest(k);
 assert.throws(()=>verifyReviewPacket(p,k),/answer key identity or evidence level mismatch/);
});
test('witness mutation cannot be legitimized by changing the answer-key digest alone',()=>{
 const k=cloned(positive.key),p=cloned(positive.packet);
 k.caseMapping[0].witnessRef='witness-'+'a'.repeat(40);
 p.postRunAnswerKeySHA256=digest(k);
 assert.throws(()=>verifyReviewPacket(p,k),/public case\/event\/witness/);
});

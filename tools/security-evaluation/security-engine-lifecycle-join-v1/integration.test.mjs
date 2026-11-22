/**
 * Pinned composite acceptance test; source modules originate from draft #157,
 * #281 and #286, not imported into this feature branch.
 * No real ARTEX / STRIDE-GPT / ExploitGym process is invoked here.
 * Actual 127.0.0.1 owned synthetic candidate/patched HTTP effects happen
 * through the existing causal study implementation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {describeEngines,createMultiEngineBoundary}
 from '../multi-engine-boundary-v1/admission.mjs';
import {prepareCausalStudy,runProviderOnce,exportPostRunCausalTruth}
 from '../causal-counterfactual-v1/protocol.mjs';
import {MODEL_ALIAS,MODEL_SHA256,OUTPUT_SCHEMA,sha256,buildPrompt,translateModelSelection}
 from '../pinned-causal-inference-v1/adapter.mjs';
import {verifyReviewPacket}
 from '../causal-postrun-review-v1/verify.mjs';
import {createEastPlatform} from '../../../src/east/platform.ts';
import {runEastTaskWithLifecycle}
 from '../../../packages/intelligence/autonomy/EastTaskLifecycleAdapter.ts';
import {TaskLifecycleCoordinator,InMemoryTaskLifecycleStore}
 from '../../../packages/intelligence/autonomy/TaskLifecycleCoordinator.ts';

const NOW='2026-11-22T16:00:00.000Z';
const POLICY_SHA='a'.repeat(64);
const pins=Object.fromEntries(describeEngines().engines.map(x=>[x.id,x.zipSha256]));
const hashJson=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const SCRIPTED='Scripted integration provider — NO REAL model inference';
const taskId='task-owned-demo-01';
const assetRef='asset:owned-demo-01';
const phases=[
 ['stride-gpt','stride-threat-model'],
 ['artex','authorized-http-replay'],
 ['exploitgym','reproduction-grading']
];
const req=(engineId,capability,index)=>({
 taskId,attemptId:'attempt-owned-'+index+'-'+engineId,
 engineId,capability,assetRef,environment:'owned-synthetic',
 engineSnapshotSha256:pins[engineId]
});

async function independentlyRegrade(study,{chooseAuditor=false}={}){
 const task=study.agentInput;
 const desired=chooseAuditor?
  {actor:'auditor',action:'audit-read'}:
  {actor:'outsider',action:'approve'};
 const selected=task.cases.find(c=>c.observations.some(o=>
  o.actor===desired.actor&&o.action===desired.action&&o.httpStatus===200));
 assert.ok(selected,'must match actual owned synthetic HTTP observations');
 const ordinal=selected.observations.find(o=>
  o.actor===desired.actor&&o.action===desired.action&&o.httpStatus===200).ordinal;
 const raw=JSON.stringify({schema:OUTPUT_SCHEMA,studyRef:task.studyRef,
  choice:'finding',caseRef:selected.caseRef,cause:'missing-owner-check',
  witnessRef:selected.witnessRef,observationOrdinal:ordinal});
 // A deterministic scripted selection, NOT a Qwen, STRIDE, ARTEX or ExploitGym model.
 const attempt=await runProviderOnce(study.handle,{generate:async({task:visible})=>
  JSON.stringify(translateModelSelection(visible,raw).submission)},
  {kind:'test-double',timeoutMs:3000});
 assert.equal(attempt.status,'scored');
 const key=exportPostRunCausalTruth(study.handle);
 const packet={
  schema:'pal-pinned-causal-local-model-attempt-v1',
  attemptedModel:MODEL_ALIAS,officialModelSHA256:MODEL_SHA256,
  externalSecurityTargets:0,oneCallStatus:'scored',reservedAttempts:1,
  modelPromotionAllowed:false,modelRuntimeAttested:false,humanReviewerValidated:false,
  trialAttempt:attempt,agentVisibleTask:task,postRunAnswerKeySHA256:hashJson(key),
  observedProvider:{declaredModel:MODEL_ALIAS,
   requestId:'scripted-provider-not-a-real-model-call',finishReason:'stop',
   rawCompletion:raw,rawCompletionSHA256:sha256(raw),
   promptSHA256:sha256(buildPrompt(task))}
 };
 return Object.freeze({packet,key,review:verifyReviewPacket(packet,key)});
}

function admittedHost({allowAll=false,denyEngine=null,journalFailure=false,
  forcedFailure=null,chooseAuditor=false}={}){
 const journal=[],reservations=new Set(),executed=[],records={};
 const counters={stop:0,scope:0,apex:0,modelCalls:0,ownedRequests:0};
 const ports={
  now:()=>new Date(NOW),
  checkStop:async()=>{counters.stop++;return {halted:false};},
  checkScope:async r=>{
   counters.scope++;
   if((denyEngine===r.engineId)||(!allowAll&&r.environment!=='owned-synthetic')){
    return {status:'out_of_scope'};
   }
   return {...r,status:'in_scope',policyDigest:POLICY_SHA};
  },
  verifyApex:async(r,scope)=>{counters.apex++;return {
   ...r,status:'verified',policyDigest:scope.policyDigest,
   approvalRef:'synthetic-host-approval',expiresAt:'2026-11-22T17:00:00Z'
  };},
  reserveAttempt:async r=>{
   const key=r.taskId+':'+r.attemptId;
   if(reservations.has(key))return {status:'duplicate'};
   reservations.add(key);return {status:'reserved',taskId:r.taskId,attemptId:r.attemptId};
  },
  journal:async e=>{
   if(journalFailure)throw Error('synthetic journal unavailable');
   journal.push(e);return {stored:true};
  },
  execute:async(r)=>{
   executed.push(r.engineId);
   if(forcedFailure===r.engineId)throw Error('ambiguous synthetic engine failure');
   switch(r.engineId){
    case 'stride-gpt':
     // This stage is a HOST TEST DOUBLE for the complete STRIDE-GPT engine.
     records.stride=Object.freeze({
      kind:'untrusted-synthetic-threat-model',riskArea:'tenant-approval',
      invariants:['same-tenant reviewer','creator/reviewer separation'],
      note:'Not an actual STRIDE-GPT process or LLM output',
      authorized:false
     });
     return records.stride;
    case 'artex':
     // Actual owned synthetic candidate/patched HTTP requests, NOT ARTEX tools.
     records.study=await prepareCausalStudy({variant:'missing-owner-check'});
     counters.ownedRequests=records.study.observedOwnedHttpRequests;
     records.artex=Object.freeze({
      kind:'local-owned-http-source-counterfactual',
      studyRef:records.study.agentInput.studyRef,
      observedOwnedHttpRequests:counters.ownedRequests,
      engineActuallyStarted:false,externalTargets:0,authorized:false
     });
     return records.artex;
    case 'exploitgym':
     if(!records.study)throw Error('missing preceding owned-source observation');
     // Actual independent source oracle; no ExploitGym container started.
     records.gym=await independentlyRegrade(records.study,{chooseAuditor});
     return {kind:'owned-offline-independent-regrade',
      reviewSchema:records.gym.review.schema,
      studyRef:records.gym.packet.agentVisibleTask.studyRef,
      independentScore:records.gym.review.independentScore,
      engineActuallyStarted:false,externalTargets:0,authorized:false};
    default:throw Error('unrecognized engine');
   }
  }
 };
 return {boundary:createMultiEngineBoundary(ports),records,counters,journal,
  reservations,executed};
}

async function runPhases(h){
 const results=[];
 for(let i=0;i<phases.length;i++){
  const [id,capability]=phases[i];
  results.push(await h.boundary.dispatch(req(id,capability,i+1)));
 }
 return results;
}

function fakeReply(request,summary){
 const challengeIds=request.contextMessages
  .filter(m=>m.messageType==='counterargument').map(m=>m.messageId);
 switch(request.stage){
  case 'independent':return {payload:{
   analysis:'Only an untrusted synthetic finding proposal: '+request.agentId,
   confidence:0.3}};
  case 'cross-review':return {payload:{question:'What is the independent source oracle?'}};
  case 'challenge':return {payload:{
   claim:'Engine found a flaw',objection:'No APEX permission follows from inference',
   evidenceRefs:[]}};
  case 'revision':return {payload:{
   revision:'Keep all engine outputs untrusted and report uncertainty.',
   addressesMessageIds:challengeIds}};
  case 'verification':return {payload:{
   claim:'Review only, no authority',verified:true,
   reason:'A model claiming verified does not grant any permission'}};
  case 'synthesis':return {payload:{
   synthesis:summary,evidenceRefs:['synthetic-gate:unverified']}};
  default:throw Error('unrecognized stage '+request.stage);
 }
}
function fakeEast(summary){
 let calls=0,seq=0;
 const platform=createEastPlatform({
  inference:{async generate(r){calls++;return fakeReply(r,summary);}},
  getResources:()=>({availableMemoryMB:8192,loadedModels:[]}),
  model:{id:'synthetic-model',name:SCRIPTED,runtimePath:'test-double-only',
   contextLength:4096,capabilities:['reason','code'],memoryEstimateMB:512},
  createId:()=> 'scoped-'+(++seq)
 });
 return {platform,getCalls:()=>calls};
}
async function persistReview(h,{backing=new InMemoryTaskLifecycleStore()}={}){
 const review=h.records.gym.review;
 assert.equal(review.consistent,true);
 assert.equal(review.humanReviewed,false);
 assert.equal(review.hardwareAttested,false);
 assert.equal(review.modelPromotionAllowed,false);
 assert.equal(review.externalTargets,0);
 const summary='UNTRUSTED SYNTHETIC SOURCE REVIEW; NO APEX GRANT. '+
  JSON.stringify({taskId,studyRef:h.records.artex.studyRef,
   source:review.sourceMutationFamily,score:review.independentScore,
   engineCallsAreTestDoubles:true});
 const e=fakeEast(summary);
 const objective='Review one owned synthetic tenant policy; no external execution';
 const eastTaskId=e.platform.createAgentTask(objective);
 const lifecycleTaskId='lifecycle-'+taskId;
 const coordinator=new TaskLifecycleCoordinator({store:backing});
 const run=await runEastTaskWithLifecycle({
  coordinator,east:e.platform,eastTaskId,lifecycleTaskId,objective});
 assert.equal(run.authorized,false);
 assert.equal(run.lifecycle.status,'completed');
 assert.equal(e.platform.getTask(eastTaskId).authorized,false);
 return {e,run,backing,eastTaskId,lifecycleTaskId,objective};
}

test('three named host approvals join source-level HTTP and independent review without promoting permission',async()=>{
 const h=admittedHost();
 const results=await runPhases(h);
 assert.deepEqual(h.executed,['stride-gpt','artex','exploitgym']);
 assert.deepEqual(results.map(x=>x.status),['host-dispatched','host-dispatched','host-dispatched']);
 assert.ok(results.every(x=>x.engineResultTrusted===false &&
  x.apexReceiptIssuedByThisModule===false&&x.deviceAttested===false));
 assert.equal(h.counters.ownedRequests,14);
 assert.equal(h.records.study.externalTargets,0);
 assert.equal(h.records.gym.review.independentScore.truePositives,1);
 assert.equal(h.records.gym.review.independentScore.falsePositives,0);
 assert.equal(h.records.gym.review.independentScore.falseNegatives,0);
 assert.equal(h.records.gym.review.selectedKind,'other-tenant-approval');
 assert.equal(h.records.gym.key.cryptographicallySigned,false);
 assert.equal(h.journal.filter(e=>e.kind==='attempt.finished').length,3);
 assert.equal(h.reservations.size,3);
 console.log('three-engine joined check: '+JSON.stringify({
  engines:h.executed,hostEmulated:true,modelCalls:0,
  httpOwnedRequests:h.counters.ownedRequests,independentScore:h.records.gym.review.independentScore,
  externalTargets:0,productionReady:false}));
});

test('a complete East task resumes without repeating fake inference after host-gated review',async()=>{
 const h=admittedHost();await runPhases(h);
 const first=await persistReview(h);
 assert.ok(first.e.getCalls()>=8);
 const restarted=fakeEast('MUST NOT REGENERATE');
 const again=await runEastTaskWithLifecycle({
  coordinator:new TaskLifecycleCoordinator({store:first.backing}),
  east:restarted.platform,eastTaskId:first.eastTaskId,
  lifecycleTaskId:first.lifecycleTaskId,objective:first.objective
 });
 assert.equal(again.authorized,false);
 assert.equal(again.lifecycle.status,'completed');
 assert.equal(again.synthesis,first.run.synthesis);
 assert.deepEqual(again.evidenceRefs,first.run.evidenceRefs);
 assert.equal(restarted.getCalls(),0,'restarted East never calls fake model');
 assert.equal(restarted.platform.getTask(first.eastTaskId).authorized,false);
 assert.equal(h.executed.length,3,'host executor is not re-invoked during East restore');
});

test('a false-positive auditor read remains a negative security-quality result',async()=>{
 const h=admittedHost({chooseAuditor:true});
 await runPhases(h);
 const review=h.records.gym.review;
 assert.equal(review.selectedKind,'auditor-read');
 assert.equal(review.selectedWasGenuineSourceDefect,false);
 assert.equal(review.independentScore.truePositives,0);
 assert.equal(review.independentScore.falsePositives,1);
 assert.equal(review.independentScore.falseNegatives,1);
 const e=await persistReview(h);
 assert.match(e.run.synthesis,/"falsePositives":1/);
 assert.equal(e.run.authorized,false);
});

test('a blocked ARTEX scope cannot start its executor or ExploitGym evaluation',async()=>{
 const h=admittedHost({denyEngine:'artex'});
 const pre=await h.boundary.dispatch(req('stride-gpt','stride-threat-model',1));
 assert.equal(pre.status,'host-dispatched');
 await assert.rejects(()=>h.boundary.dispatch(req('artex','authorized-http-replay',2)),
  /scope unavailable/);
 assert.deepEqual(h.executed,['stride-gpt']);
 assert.equal(h.counters.ownedRequests,0);
 assert.equal(h.records.gym,undefined);
});

test('an arbitrary approved-target request is never allowed by the synthetic host',async()=>{
 const h=admittedHost();
 const bad={...req('artex','authorized-tool-execution',2),environment:'approved-target'};
 await assert.rejects(()=>h.boundary.dispatch(bad),/scope unavailable/);
 assert.equal(h.executed.length,0);
 assert.equal(h.reservations.size,0);
});

test('a mismatched engine pin and a replayed attempt fail before effects',async()=>{
 const h=admittedHost();
 const r=req('exploitgym','isolated-trial',2);
 await assert.rejects(()=>h.boundary.dispatch({...r,engineSnapshotSha256:'0'.repeat(64)}),
  /unverified or changed engine snapshot pin/);
 const ok=await h.boundary.dispatch(r);
 assert.equal(ok.status,'unknown-reconciliation-required'); // missing preceding study
 assert.equal(h.executed.length,1);
 await assert.rejects(()=>h.boundary.dispatch(r),/attempt duplicate/);
 assert.equal(h.executed.length,1);
});

test('a broken audit makes a three-engine attempt impossible before execution',async()=>{
 const h=admittedHost({journalFailure:true});
 await assert.rejects(()=>h.boundary.dispatch(req('stride-gpt','stride-threat-model',1)),
  /synthetic journal unavailable/);
 assert.equal(h.executed.length,0);
 assert.equal(h.reservations.size,0);
});

test('ambiguous ARTEX side effects are not silently re-run or counted as evidence',async()=>{
 const h=admittedHost({forcedFailure:'artex'});
 await h.boundary.dispatch(req('stride-gpt','stride-threat-model',1));
 const x=await h.boundary.dispatch(req('artex','authorized-http-replay',2));
 assert.equal(x.status,'unknown-reconciliation-required');
 assert.equal(h.records.study,undefined);
 assert.equal(h.journal.filter(e=>e.kind==='attempt.uncertain').length,1);
 await assert.rejects(()=>h.boundary.dispatch(req('artex','authorized-http-replay',2)),
  /attempt duplicate/);
 assert.deepEqual(h.executed,['stride-gpt','artex']);
});

test('all attempts retain exact one task and distinct engine/attempt identities',async()=>{
 const h=admittedHost();await runPhases(h);
 const calls=h.journal.filter(e=>e.kind==='admission.checked');
 assert.deepEqual(calls.map(x=>x.taskId),[taskId,taskId,taskId]);
 assert.equal(new Set(calls.map(x=>x.attemptId)).size,3);
 assert.equal(new Set(calls.map(x=>x.engineId)).size,3);
 assert.ok(calls.every(x=>x.scopeDigest===POLICY_SHA &&
  x.assetRef===assetRef && x.approvalRef==='synthetic-host-approval'));
 assert.equal(h.counters.modelCalls,0);
 assert.equal(h.counters.apex,3);
 assert.equal(h.counters.stop,9);
});

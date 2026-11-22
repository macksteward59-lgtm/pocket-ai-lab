/**
 * Cross-feature, source-pinned SYNTHETIC integration smoke. This test is only
 * used on a read-only composite checkout of existing draft #157 and #281.
 * Never promotes an agent report, East synthesis or review to APEX permission.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareCausalStudy,runProviderOnce,exportPostRunCausalTruth}
  from '../causal-counterfactual-v1/protocol.mjs';
import {MODEL_ALIAS,MODEL_SHA256,OUTPUT_SCHEMA,sha256,buildPrompt,translateModelSelection}
  from '../pinned-causal-inference-v1/adapter.mjs';
import {verifyReviewPacket} from '../causal-postrun-review-v1/verify.mjs';
import {createEastPlatform} from '../../../src/east/platform.ts';
import {runEastTaskWithLifecycle} from '../../../packages/intelligence/autonomy/EastTaskLifecycleAdapter.ts';
import {TaskLifecycleCoordinator,InMemoryTaskLifecycleStore}
  from '../../../packages/intelligence/autonomy/TaskLifecycleCoordinator.ts';

const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const source=Object.freeze({
  eastSource:'ab2ad101d1a2ebfa277bd2c136db79b6b1afc094',
  causalSource:'e42467012abefe3d5f6083ab6dbfcdbe9f9a148f',
});

async function makeObservedTrial({selectedKind='other-tenant-approval'}={}){
  // No real Qwen. This generates a fresh owned 127.0.0.1 source-mutation
  // counterfactual and a scripted transport response for cross-feature testing.
  const study=await prepareCausalStudy({variant:'missing-owner-check'});
  const task=study.agentInput;
  let selected;
  if(selectedKind==='auditor-read'){
    selected=task.cases.find(c=>c.observations.some(o=>
      o.actor==='auditor'&&o.action==='audit-read'&&o.httpStatus===200));
  }else{
    selected=task.cases.find(c=>c.observations.some(o=>
      o.actor==='outsider'&&o.action==='approve'&&o.httpStatus===200));
  }
  assert.ok(selected,'owned fixture must contain expected HTTP event');
  const ordinal=1+selected.observations.findIndex(o=>selectedKind==='auditor-read'?
    o.actor==='auditor'&&o.action==='audit-read'&&o.httpStatus===200:
    o.actor==='outsider'&&o.action==='approve'&&o.httpStatus===200);
  assert.ok(ordinal>0);
  const raw=JSON.stringify({
    schema:OUTPUT_SCHEMA,studyRef:task.studyRef,choice:'finding',caseRef:selected.caseRef,
    cause:'missing-owner-check',witnessRef:selected.witnessRef,observationOrdinal:ordinal
  });
  // This is an injected test double. It MUST NOT be counted as model inference.
  const provider={generate:async({task:agentTask})=>
    JSON.stringify(translateModelSelection(agentTask,raw).submission)};
  assert.throws(()=>exportPostRunCausalTruth(study.handle),/before completed scoring/);
  const attempt=await runProviderOnce(study.handle,provider,{kind:'test-double',timeoutMs:2000});
  assert.equal(attempt.status,'scored');
  const key=exportPostRunCausalTruth(study.handle);
  const packet={
    schema:'pal-pinned-causal-local-model-attempt-v1',
    attemptedModel:MODEL_ALIAS,officialModelSHA256:MODEL_SHA256,
    externalSecurityTargets:0,oneCallStatus:'scored',reservedAttempts:1,
    modelPromotionAllowed:false,modelRuntimeAttested:false,humanReviewerValidated:false,
    trialAttempt:attempt,agentVisibleTask:task,postRunAnswerKeySHA256:digest(key),
    observedProvider:{
      declaredModel:MODEL_ALIAS,requestId:'scripted-not-a-real-model-generation',
      finishReason:'stop',rawCompletion:raw,rawCompletionSHA256:sha256(raw),
      promptSHA256:sha256(buildPrompt(task))
    }
  };
  return {packet,key};
}

function fakeReply(request,summary){
  const challengeIds=request.contextMessages
    .filter(message=>message.messageType==='counterargument')
    .map(message=>message.messageId);
  switch(request.stage){
    case 'independent':
      return {payload:{analysis:'Review synthetic source evidence only: '+request.agentId,confidence:0.4}};
    case 'cross-review':
      return {payload:{question:'Was the cited operation unauthorized under its role?'}};
    case 'challenge':
      return {payload:{claim:'Agent evidence may be incorrect',objection:'No trusted authorization receipt exists',evidenceRefs:[]}};
    case 'revision':
      return {payload:{revision:'Do not treat case evidence as an approval.',addressesMessageIds:challengeIds}};
    case 'verification':
      // A model's self-asserted verified:true cannot become permission.
      return {payload:{claim:'Review is synthetic and untrusted',verified:true,
        reason:'A model claim is not an APEX decision'}};
    case 'synthesis':
      return {payload:{synthesis:summary,evidenceRefs:['synthetic-review:no-authority']},
        evidenceRefs:['synthetic-review:no-authority']};
    default: throw Error('Unknown synthetic stage '+request.stage);
  }
}

function makeEastRuntime(summary){
  let calls=0,ids=0;
  const platform=createEastPlatform({
    inference:{async generate(request){calls++;return fakeReply(request,summary);}},
    getResources:()=>({availableMemoryMB:8192,loadedModels:[]}),
    model:{
      id:'integration-scripted-provider',name:'Scripted synthetic test double',
      runtimePath:'not-a-real-model',contextLength:4096,
      capabilities:['reason','code'],memoryEstimateMB:512
    },
    createId:()=> 'integration-'+(++ids)
  });
  return {platform,getCalls:()=>calls};
}

/** Host gate is deliberately outside East. It validates evidence consistency
 * but does not grant APEX authorization, deploy, scan or approve a finding. */
async function proposeReviewedSyntheticTask({packet,key,store=undefined,existing=undefined}){
  const review=verifyReviewPacket(packet,key); // throws before any new East activity
  assert.equal(review.consistent,true);
  assert.equal(review.modelPromotionAllowed,false);
  assert.equal(review.hardwareAttested,false);
  assert.equal(review.humanReviewed,false);
  const summary='MODEL CLAIMED PROPOSAL — NOT AUTHORIZED. Synthetic review '
    +JSON.stringify({source:review.sourceMutationFamily,selectedKind:review.selectedKind,
      score:review.independentScore,sourcePins:source});
  const runtime=existing??makeEastRuntime(summary);
  const backing=store??new InMemoryTaskLifecycleStore();
  const objective='Assess owned synthetic red-team evidence without executing targets';
  const eastTaskId=runtime.platform.createAgentTask(objective);
  const lifecycleTaskId='synthetic-review-'+packet.agentVisibleTask.studyRef;
  const coordinator=new TaskLifecycleCoordinator({store:backing});
  const run=await runEastTaskWithLifecycle({
    coordinator,east:runtime.platform,eastTaskId,lifecycleTaskId,objective
  });
  assert.equal(run.authorized,false);
  assert.equal(runtime.platform.getTask(eastTaskId).authorized,false);
  assert.equal(run.lifecycle.status,'completed');
  assert.ok(run.synthesis.includes('NOT AUTHORIZED'));
  assert.ok(run.synthesis.includes('Synthetic review'));
  return {review,runtime,backing,run,lifecycleTaskId,eastTaskId,objective};
}

test('genuine source defect stays a review proposal, never an APEX grant',async()=>{
  const {packet,key}=await makeObservedTrial();
  const {run,review,runtime}=await proposeReviewedSyntheticTask({packet,key});
  assert.equal(review.independentScore.truePositives,1);
  assert.equal(review.independentScore.falsePositives,0);
  assert.equal(review.selectedKind,'other-tenant-approval');
  assert.equal(review.reviewClass,'unsigned-post-run-self-consistency-and-independent-source-regrade');
  assert.ok(runtime.getCalls()>=8,'real East stages consume synthetic inference test doubles');
  assert.equal(run.apexDecision.status!=='approved',true);
  assert.equal(run.authorized,false);
  assert.equal(run.lifecycle.steps.every(s=>s.status==='succeeded'),true);
});

test('legitimate auditor read is retained as a false positive without authorization',async()=>{
  const {packet,key}=await makeObservedTrial({selectedKind:'auditor-read'});
  const {run,review}=await proposeReviewedSyntheticTask({packet,key});
  assert.equal(review.selectedKind,'auditor-read');
  assert.equal(review.selectedWasGenuineSourceDefect,false);
  assert.equal(review.independentScore.truePositives,0);
  assert.equal(review.independentScore.falsePositives,1);
  assert.equal(review.independentScore.falseNegatives,1);
  assert.equal(run.authorized,false);
  assert.ok(run.synthesis.includes('"falsePositives":1'));
});

test('after a fresh East runtime restart, a completed reviewed task does not rerun agents',async()=>{
  const {packet,key}=await makeObservedTrial();
  const {run,backing,objective,eastTaskId,lifecycleTaskId,runtime}=await proposeReviewedSyntheticTask({packet,key});
  const earlierCount=runtime.getCalls();
  assert.ok(earlierCount>0);
  const restarted=makeEastRuntime('This must never be regenerated');
  const resumed=await runEastTaskWithLifecycle({
    coordinator:new TaskLifecycleCoordinator({store:backing}),
    east:restarted.platform,eastTaskId,lifecycleTaskId,objective
  });
  assert.equal(resumed.lifecycle.status,'completed');
  assert.equal(resumed.authorized,false);
  assert.equal(restarted.getCalls(),0);
  assert.equal(runtime.getCalls(),earlierCount);
  assert.equal(resumed.synthesis,run.synthesis);
  assert.deepEqual(resumed.evidenceRefs,run.evidenceRefs);
  assert.equal(restarted.platform.getTask(eastTaskId).authorized,false);
});

test('host review mismatch prevents *any* East task or provider initialization',async()=>{
  const {packet,key}=await makeObservedTrial();
  const corrupted=structuredClone(key);
  corrupted.caseMapping[0].expectedFinding=!corrupted.caseMapping[0].expectedFinding;
  let started=0;
  const guard=async()=>{
    verifyReviewPacket(packet,corrupted);
    started++;
    return makeEastRuntime('Unreachable');
  };
  await assert.rejects(guard(),/answer key digest mismatch/);
  assert.equal(started,0,'host gate did not initiate an East runtime');
});

test('the exact original negative trial is not imported or rewritten by this smoke',()=>{
  assert.equal(source.causalSource,'e42467012abefe3d5f6083ab6dbfcdbe9f9a148f');
  assert.equal(source.eastSource,'ab2ad101d1a2ebfa277bd2c136db79b6b1afc094');
});

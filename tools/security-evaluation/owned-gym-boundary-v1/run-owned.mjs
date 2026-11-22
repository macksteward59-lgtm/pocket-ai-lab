/**
 * Execute only prebuilt owned synthetic counterfactuals inside an externally
 * configured non-root, --network none, --read-only Docker worker.
 * This is a compatibility probe, NOT an ExploitGym executor or APEX grant.
 */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {prepareCausalStudy,scoreSubmission,publicObservationBaseline}
  from '../causal-counterfactual-v1/protocol.mjs';

const uid=typeof process.getuid==='function'?process.getuid():null;
assert.equal(uid,65534,'owned-only container must be non-root uid 65534');
const interfaces=networkInterfaces();
for(const [name,addresses] of Object.entries(interfaces)){
  for(const address of addresses??[]){
    assert.equal(address.internal,true,
      'unexpected outward-facing network interface '+name);
  }
}
assert.ok(Object.keys(interfaces).length>0,'missing verified local interface');

let readonlyBlocked=false;
try {
  await writeFile('/work/owned-gym-unexpected-write.txt','not permitted',{flag:'wx'});
} catch(e) {
  if(e?.code==='EROFS'||e?.code==='EACCES') readonlyBlocked=true;
  else throw e;
}
assert.equal(readonlyBlocked,true,'worker attempted to write to root filesystem');

const studies=[];
let localRequests=0;
for(const variant of ['missing-owner-check','missing-separation-check']){
  const study=await prepareCausalStudy({variant});
  assert.equal(study.actualModelCalls,0);
  assert.equal(study.externalTargets,0);
  const score=scoreSubmission(study.handle,publicObservationBaseline(study.agentInput));
  assert.equal(score.truePositives,1);
  assert.equal(score.falsePositives,0);
  assert.equal(score.falseNegatives,0);
  assert.equal(score.externalTargets,0);
  assert.equal(score.realModelExecutionVerified,false);
  assert.equal(score.independentReviewerAttested,false);
  assert.equal(score.modelGeneralizationEstablished,false);
  localRequests+=study.observedOwnedHttpRequests;
  studies.push({
    family:variant,taskBindingPresent:Boolean(study.agentInput.studyRef),
    ownedLoopbackRequests:study.observedOwnedHttpRequests,
    scriptOnlyScore:{tp:score.truePositives,fp:score.falsePositives,fn:score.falseNegatives},
    genuineNewVulnerabilityFamily:false,realModelCalls:0,apexAuthorized:false
  });
}
assert.equal(localRequests,28,'expected bounded local counterfactual coverage changed');
console.log(JSON.stringify({
  schema:'pal-owned-gym-boundary-smoke-v1',
  status:'synthetic-local-only-sandbox-behavior-observed',
  runningAsUid:uid,visibleNetworkInterfaces:Object.keys(interfaces),
  rootFilesystemWriteDenied:readonlyBlocked,
  isolatedWorkerDeclaredByHost:false,
  externalSecurityTargets:0,hostAuthorizationGranted:false,
  productionExploitGymExecutionVerified:false,modelOrRuntimeAttested:false,
  humanReviewerValidated:false,localRequests,studies
}));

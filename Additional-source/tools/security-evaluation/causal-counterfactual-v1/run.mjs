/** Synthetic causal-differential evaluation demo; NO language model executed. */
import {fileURLToPath} from 'node:url';
import {prepareCausalStudy,scoreSubmission,publicObservationBaseline,runProviderOnce} from './protocol.mjs';

export async function runStudyDemo(){
 const output=[];
 for(const variant of ['missing-owner-check','missing-separation-check']){
  const s=await prepareCausalStudy({variant});
  const simple=scoreSubmission(s.handle,publicObservationBaseline(s.agentInput));
  const naive=scoreSubmission(s.handle,publicObservationBaseline(s.agentInput,{allFindings:true}));
  if(simple.truePositives!==1||simple.falsePositives!==0||naive.falsePositives!==5)throw Error('causal smoke baseline changed');
  const once=await prepareCausalStudy({variant});
  const trial=await runProviderOnce(once.handle,{generate:async({task})=>publicObservationBaseline(task)},{kind:'test-double'});
  if(trial.status!=='scored'||trial.score.truePositives!==1)throw Error('provider port regression');
  output.push({studyKind:'new-randomized-owned-instance-not-unseen-template',variantKnownToHostOnly:true,visibleCases:s.agentInput.cases.length,
    observedOwnedHttpRequests:s.observedOwnedHttpRequests,ruleOnly:{tp:simple.truePositives,fp:simple.falsePositives,fn:simple.falseNegatives},
    naive:{tp:naive.truePositives,fp:naive.falsePositives},testDoubleCalls:1,realModelCalls:0,externalTargets:0});
 }
 return {schema:'pal-causal-differential-demo-v1',statuses:output,rootCauseIdentity:'synthetic source-mutation counterfactual only',
  independentReviewAttested:false,unseenVulnerabilityFamily:false,liveModelExecuted:false,realWorldSecurityFinding:false};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 try{console.log(JSON.stringify(await runStudyDemo(),null,2))}catch(e){console.error(e);process.exitCode=1;}
}

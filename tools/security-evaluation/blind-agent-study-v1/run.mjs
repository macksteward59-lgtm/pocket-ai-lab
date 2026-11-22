/** Public synthetic protocol demonstration: NO MODEL is invoked here. */
import {fileURLToPath} from 'node:url';
import {prepareAgentFacingStudy,observableOnlyBaseline,gradeCompletedResponse,
  runOneProviderAttempt,AGENT_SCHEMA} from './protocol.mjs';

export async function runBlindedProtocolDemo(){
  const a=await prepareAgentFacingStudy();
  const rule=gradeCompletedResponse(a.handle,observableOnlyBaseline(a.agentInput));
  const naive=gradeCompletedResponse(a.handle,observableOnlyBaseline(a.agentInput,{allFindings:true}));
  // Deliberate deterministic test-double, consuming at most one provider port call.
  const fake=await prepareAgentFacingStudy();
  const provider={generate:async({task})=>JSON.stringify(observableOnlyBaseline(task))};
  const attempt=await runOneProviderAttempt(fake.handle,provider,{kind:'test-double'});
  if(attempt.status!=='scored'||rule.truePositives!==2||naive.adminFalsePositives!==1){
    throw Error('synthetic protocol regression failed');
  }
  return Object.freeze({schema:AGENT_SCHEMA,publicFixtureRehearsal:true,
    hiddenFromAgent:['owner-labels','oracle-review-status','fixture-mode','host-session-handle'],
    visibleCases:a.agentInput.cases.length,observedLocalHttpRequests:a.observedLocalHttpRequests,
    localEvidenceSelfConsistencyOnly:true,
    deterministicObservations:{truePositives:rule.truePositives,falsePositives:rule.falsePositives},
    naiveAllFindings:{truePositives:naive.truePositives,falsePositives:naive.falsePositives,
      legitimateAdministratorFalsePositives:naive.adminFalsePositives},
    testDoubleCall:attempt.status,realModelCalls:0,modelExecutionProven:false,
    freshHeldoutCases:false,hostSignatureVerified:false,externalTargets:0,wholeProductIntegrated:false});
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  try{console.log(JSON.stringify(await runBlindedProtocolDemo(),null,2));}
  catch(e){console.error(e);process.exitCode=1;}
}

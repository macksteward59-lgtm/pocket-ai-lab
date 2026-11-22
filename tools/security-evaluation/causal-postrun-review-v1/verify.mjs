/**
 * Offline, read-only cross-check of a post-run synthetic causal study.
 * Two separate files: model-visible task/result and a host-only answer key
 * disclosed AFTER scoring. Neither digest nor GitHub CI is a digital signature.
 */
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {CASE_KINDS} from '../causal-counterfactual-v1/fixture.mjs';
import {validateCounterfactualPair} from '../causal-counterfactual-v1/oracle.mjs';
import {MODEL_ALIAS,MODEL_SHA256,sha256,buildPrompt,translateModelSelection} from '../pinned-causal-inference-v1/adapter.mjs';

const hashJson=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function insist(condition,reason){if(!condition)throw Error('post-run review: '+reason);}
const SCORE_FIELDS=['truePositives','falsePositives','falseNegatives','trueNegatives',
  'abstentions','incorrectSourceCauseClaims','incorrectWitnessOrOperation','precision','recall'];

/** Grade solely from saved candidate observations and saved source labels,
 * without calling the live WeakMap-based host scorer or trusting its totals. */
export function gradeOffline(task,answerKey,submission){
 const mapping=new Map(answerKey.caseMapping.map(row=>[row.caseRef,row]));
 let tp=0,fp=0,fn=0,tn=0,abstentions=0,badCause=0,badWitness=0;
 for(const s of submission.submissions){
  const truth=mapping.get(s.caseRef);
  insist(truth,'unknown case in model output');
  const candidate=answerKey.results[truth.kind].candidate;
  if(s.decision==='finding'){
   const witness=candidate.observations.find(x=>
     x.actor===s.actor&&x.operation===s.action&&x.resourceId===s.resourceId);
   const matched=truth.expectedFinding&&s.cause===truth.sourceCause&&
     s.evidenceRef===truth.witnessRef&&witness?.httpStatus===200;
   if(matched)tp++;else{
    fp++;if(s.cause!==truth.sourceCause||!truth.expectedFinding)badCause++;
    if(s.evidenceRef!==truth.witnessRef||!witness)badWitness++;
    if(truth.expectedFinding)fn++;
   }
  }else{
   if(s.decision==='abstain')abstentions++;
   if(truth.expectedFinding)fn++;else if(s.decision==='no-finding')tn++;
  }
 }
 return {truePositives:tp,falsePositives:fp,falseNegatives:fn,trueNegatives:tn,
  abstentions,incorrectSourceCauseClaims:badCause,incorrectWitnessOrOperation:badWitness,
  precision:tp+fp?Number((tp/(tp+fp)).toFixed(6)):0,
  recall:tp+fn?Number((tp/(tp+fn)).toFixed(6)):0};
}

/**
 * A valid result proves JSON-level consistency and regradability of the OWNED
 * synthetic study only. The author can replace both unsigned files together.
 */
export function verifyReviewPacket(packet,answerKey){
 insist(packet&&typeof packet==='object'&&answerKey&&typeof answerKey==='object',
  'two independent JSON inputs are required');
 insist(packet.schema==='pal-pinned-causal-local-model-attempt-v1',
  'unsupported source artifact schema');
 insist(packet.oneCallStatus==='scored'&&packet.trialAttempt?.status==='scored'&&
  packet.trialAttempt.attemptCount===1&&packet.reservedAttempts===1,
  'not one completed scorable call');
 insist(packet.externalSecurityTargets===0&&packet.modelPromotionAllowed===false&&
  packet.modelRuntimeAttested===false&&packet.humanReviewerValidated===false,
  'untrusted source or promotion claims');
 insist(packet.attemptedModel===MODEL_ALIAS&&packet.officialModelSHA256===MODEL_SHA256,
  'model choice or official GGUF pin differs');
 insist(packet.agentVisibleTask?.schema==='pal-causal-differential-task-v1'&&
  packet.agentVisibleTask.cases?.length===6,'missing full agent-visible task');
 insist(answerKey.schema==='pal-causal-postrun-host-truth-v1'&&
  answerKey.studyRef===packet.agentVisibleTask.studyRef &&
  answerKey.cryptographicallySigned===false && answerKey.humanReviewerAttested===false,
  'answer key identity or evidence level mismatch');
 insist(packet.postRunAnswerKeySHA256===hashJson(answerKey),
  'separate answer key digest mismatch');
 const agentTask=packet.agentVisibleTask,provider=packet.observedProvider;
 insist(provider?.declaredModel===MODEL_ALIAS&&provider.finishReason==='stop'&&
  typeof provider.requestId==='string'&&provider.requestId.length>0,
  'no complete attributable local model response');
 insist(typeof provider.rawCompletion==='string'&&
  Buffer.byteLength(provider.rawCompletion,'utf8')<=12*1024,
  'missing or oversized original raw completion');
 insist(provider.rawCompletionSHA256===sha256(provider.rawCompletion),
  'original raw completion digest mismatch');
 insist(provider.promptSHA256===sha256(buildPrompt(agentTask)),
  'model-visible prompt digest mismatch');
 insist(answerKey.results&&answerKey.caseMapping?.length===6,
  'missing host-only counterfactual data or case mapping');
 const oracle=validateCounterfactualPair({
  variant:answerKey.sourceMutationFamily,results:answerKey.results});
 insist(oracle.ok===true&&same(oracle,answerKey.oracle),
  'candidate/patched source-oracle contradiction');
 insist(answerKey.resultsCommitment===hashJson({results:answerKey.results,oracle:answerKey.oracle}),
  'counterfactual results commitment mismatch');
 const caseRefs=new Set(),kinds=new Set();
 let requests=0;
 for(const kind of CASE_KINDS){
  const pair=answerKey.results[kind];
  insist(pair&&pair.candidate&&pair.patched,'absent paired source case');
  requests+=pair.candidate.requestCount+pair.patched.requestCount;
 }
 insist(answerKey.observedOwnedHttpRequests===requests&&requests>0,
  'bounded loopback HTTP count differs');
 for(const row of answerKey.caseMapping){
  insist(typeof row.caseRef==='string'&&!caseRefs.has(row.caseRef)&&
   CASE_KINDS.includes(row.kind)&&!kinds.has(row.kind),
   'duplicate or unrecognized truth mapping');
  caseRefs.add(row.caseRef);kinds.add(row.kind);
  const taskRow=agentTask.cases.find(c=>c.caseRef===row.caseRef);
  const recorded=answerKey.results[row.kind].candidate.observations;
  const visible=recorded.map((x,i)=>({ordinal:i+1,actor:x.actor,action:x.operation,
   resourceId:x.resourceId,httpStatus:x.httpStatus,response:x.response}));
  insist(Boolean(taskRow)&&taskRow.witnessRef===row.witnessRef&&
   row.witnessRef==='witness-'+hashJson(recorded).slice(0,40)&&
   same(taskRow.observations,visible),
   'public case/event/witness differs from host replay');
  insist(row.expectedFinding===(row.kind===oracle.causalCaseKind)&&
   row.sourceCause===answerKey.sourceMutationFamily,
   'host source labels disagree with counterfactual oracle');
 }
 insist(caseRefs.size===6&&agentTask.cases.every(c=>caseRefs.has(c.caseRef)),
  'model-visible cases do not match host-only mapping');
 const translated=translateModelSelection(agentTask,provider.rawCompletion);
 const independentScore=gradeOffline(agentTask,answerKey,translated.submission);
 for(const name of SCORE_FIELDS)insist(
  packet.trialAttempt.score?.[name]===independentScore[name],
  'original score differs from independent regrade: '+name);
 insist(packet.trialAttempt.score?.sourceIdentityLevel==='host-injected-source-mutation-only'&&
  packet.trialAttempt.score?.independentReviewerAttested===false,
  'source identity claim exceeds the owned synthetic evidence');
 const chosen=translated.modelSelectedCaseRef;
 const truth=answerKey.caseMapping.find(x=>x.caseRef===chosen);
 return Object.freeze({
  schema:'pal-causal-independent-review-v1',consistent:true,
  originalModelResponseId:provider.requestId,
  modelChoice:translated.choice,selectedCaseRef:chosen,
  selectedKind:truth?.kind??null,selectedWasGenuineSourceDefect:truth?.expectedFinding??null,
  independentScore,sourceMutationFamily:oracle.sourceMutationFamily,
  reviewClass:'unsigned-post-run-self-consistency-and-independent-source-regrade',
  humanReviewed:false,hardwareAttested:false,modelPromotionAllowed:false,externalTargets:0,
 });
}

async function readBoundedJson(file){
 const info=await stat(file);insist(info.isFile()&&info.size>0&&info.size<=512*1024,
  'not a bounded regular JSON file');
 return JSON.parse(await readFile(file,'utf8'));
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
 try{
  const files=process.argv.slice(2);
  insist(files.length===2,'usage: node verify.mjs trial.json trial.json.answer-key.json');
  const [publicData,hostTruth]=await Promise.all(files.map(readBoundedJson));
  console.log(JSON.stringify(verifyReviewPacket(publicData,hostTruth),null,2));
 }catch(e){console.error(String(e?.message||e).slice(0,400));process.exitCode=1;}
}

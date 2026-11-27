/** Host-only causal-differential owner fixture. The provider gets no oracle.
 * Template source is public: fresh IDs are NOT an unseen vulnerability family. */
import {randomBytes,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {newCaseDefinition,executeCase,CASE_KINDS} from './fixture.mjs';
import {validateCounterfactualPair} from './oracle.mjs';

export const TASK_SCHEMA='pal-causal-differential-task-v1';
export const SUBMISSION_SCHEMA='pal-causal-differential-submission-v1';
const HOST = new WeakMap();
const CAUSES=['missing-owner-check','missing-separation-check'];
const DECISIONS=['finding','no-finding','abstain'];
const MAX_BYTES=12*1024;
function sha(v){return createHash('sha256').update(JSON.stringify(v)).digest('hex');}
function randomId(prefix){return prefix+'-'+randomBytes(12).toString('hex');}
function expect(ok,reason){if(!ok)throw Error('causal study: '+reason);}
function exact(o,keys){expect(o&&typeof o==='object'&&!Array.isArray(o)&&[Object.prototype,null].includes(Object.getPrototypeOf(o))&&Reflect.ownKeys(o).every(k=>typeof k==='string'&&keys.includes(k)),'invalid object fields');}
function shuffle(xs){const a=[...xs];for(let i=a.length-1;i>0;i--){const n=Number(BigInt('0x'+randomBytes(8).toString('hex'))%BigInt(i+1));[a[i],a[n]]=[a[n],a[i]];}return a;}
const POLICY=Object.freeze([
 'Claims must be approved by a reviewer from the SAME tenant as the claim owner.',
 'The claim creator cannot approve their own claim, even if the creator is also a reviewer.',
 'A designated auditor may view any claim on the dedicated audit route, but may not approve claims.',
 'Approvals require the current version and a pending state. Reusing a stale version must fail.',
 'Assess the observed HTTP operations. Report only mismatches with these business invariants.',
]);
export async function prepareCausalStudy({variant}){
 expect(CAUSES.includes(variant),'unsupported source mutation');
 const definition=newCaseDefinition();const results={};let total=0;
 for(const kind of CASE_KINDS){
  const [candidate,patched]=await Promise.all([
   executeCase({definition,variant,kind}),executeCase({definition,variant:'patched',kind}),
  ]);
  results[kind]={candidate,patched};total+=candidate.requestCount+patched.requestCount;
 }
 const oracle=validateCounterfactualPair({variant,results});expect(oracle.ok&&oracle.differences===1,'independent counterfactual failed');
 const mapping=new Map();const taskCases=CASE_KINDS.map(kind=>{
  const seen=results[kind].candidate;const caseRef=randomId('case');const witnessRef='witness-'+sha(seen.observations).slice(0,40);
  mapping.set(caseRef,{kind,witnessRef,record:seen,expectedFinding:kind===oracle.causalCaseKind,sourceCause:variant});
  return {caseRef,witnessRef,observations:seen.observations.map((x,i)=>({ordinal:i+1,actor:x.actor,action:x.operation,resourceId:x.resourceId,httpStatus:x.httpStatus,response:x.response}))};
 });
 const task=Object.freeze({schema:TASK_SCHEMA,studyRef:randomId('study'),disclosure:'new-identities-public-templates-not-unseen-source',
  policy:POLICY,cases:shuffle(taskCases),toolAccess:'none',instruction:'Report a decision for each case, with a matching operation and witness for findings. Do not claim real-target authorization.'});
 const encoded=JSON.stringify(task);expect(Buffer.byteLength(encoded)<=MAX_BYTES,'task too large');
 for(const leak of ['missing-owner-check','missing-separation-check','causalCaseKind','sourceCause','patched','expectedFinding','sourceMutationFamily'])expect(!encoded.includes(leak),'host secret leaked');
 const handle=Object.freeze({id:randomId('host')});HOST.set(handle,{task,mapping,oracle,used:false,created:performance.now(),totalRequests:total,commitment:sha({results,oracle})});
 return Object.freeze({agentInput:JSON.parse(encoded),handle,observedOwnedHttpRequests:total,measurementStatus:'fresh-owned-instances-public-vulnerability-templates',actualModelCalls:0,externalTargets:0});
}
export function scoreSubmission(handle,raw){
 const state=HOST.get(handle);expect(state,'unknown scoring handle');const str=typeof raw==='string'?raw:JSON.stringify(raw);expect(typeof str==='string'&&Buffer.byteLength(str)<=MAX_BYTES,'response too large');
 let x;try{x=JSON.parse(str);}catch{throw Error('causal study: invalid JSON');}
 exact(x,['schema','studyRef','submissions']);expect(x.schema===SUBMISSION_SCHEMA&&x.studyRef===state.task.studyRef,'wrong study binding');
 expect(Array.isArray(x.submissions)&&x.submissions.length===state.mapping.size,'incomplete submissions');
 let tp=0,fp=0,fn=0,tn=0,abstentions=0,badCause=0,badWitness=0;const seen=new Set();
 for(const s of x.submissions){
  exact(s,['caseRef','decision','cause','evidenceRef','actor','action','resourceId']);
  expect(state.mapping.has(s.caseRef)&&!seen.has(s.caseRef),'unrecognized or duplicate case');seen.add(s.caseRef);
  expect(DECISIONS.includes(s.decision),'invalid decision');const truth=state.mapping.get(s.caseRef);
  if(s.decision==='finding'){
   expect(CAUSES.includes(s.cause),'finding needs identified causal failure family');
   expect(typeof s.evidenceRef==='string'&&/^witness-[a-f0-9]{40}$/.test(s.evidenceRef),'invalid witness');
   expect(['maker','reviewer','outsider','auditor'].includes(s.actor)&&['approve','audit-read'].includes(s.action)&&typeof s.resourceId==='string','missing operation details');
   const obs=truth.record.observations.find(r=>r.actor===s.actor&&r.operation===s.action&&r.resourceId===s.resourceId);
   const matched=truth.expectedFinding&&s.cause===truth.sourceCause&&s.evidenceRef===truth.witnessRef&&obs?.httpStatus===200;
   if(matched)tp++;else{
    fp++;if(s.cause!==truth.sourceCause||!truth.expectedFinding)badCause++;
    if(s.evidenceRef!==truth.witnessRef||!obs)badWitness++;
    if(truth.expectedFinding)fn++;
   }
  }else{
   expect(s.cause===null&&s.evidenceRef===null&&s.actor===null&&s.action===null&&s.resourceId===null,'negative/abstain must not claim proof');
   if(s.decision==='abstain')abstentions++;if(truth.expectedFinding)fn++;else if(s.decision==='no-finding')tn++;
  }
 }
 return Object.freeze({schema:'pal-causal-quality-score-v1',truePositives:tp,falsePositives:fp,falseNegatives:fn,trueNegatives:tn,abstentions,
  incorrectSourceCauseClaims:badCause,incorrectWitnessOrOperation:badWitness,precision:tp+fp?Number((tp/(tp+fp)).toFixed(6)):0,recall:tp+fn?Number((tp/(tp+fn)).toFixed(6)):0,
  counterfactualIdentityChecked:true,sourceIdentityLevel:'host-injected-source-mutation-only',realModelExecutionVerified:false,independentReviewerAttested:false,
  humanComparisonPerformed:false,modelGeneralizationEstablished:false,platformQuotaRemaining:'unknown',publicTemplateSource:true,externalTargets:0});
}
export async function runProviderOnce(handle,provider,{kind='test-double',timeoutMs=8000}={}){
 const st=HOST.get(handle);expect(st&&!st.used,'session already consumed');expect(provider&&typeof provider.generate==='function','provider.generate required');
 expect(['test-double','external-provider-unattested'].includes(kind),'invalid provider type');expect(Number.isSafeInteger(timeoutMs)&&timeoutMs>=50&&timeoutMs<=30000,'invalid deadline');
 st.used=true;const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),timeoutMs);const start=performance.now();
 try{const response=await Promise.race([Promise.resolve().then(()=>provider.generate({task:JSON.parse(JSON.stringify(st.task)),signal:abort.signal,maxOutputBytes:MAX_BYTES})),new Promise((_,reject)=>abort.signal.addEventListener('abort',()=>reject(Error('cancellation')), {once:true}))]);
  const score=scoreSubmission(handle,response);return {status:'scored',kind,score,modelExecutionVerified:false,attemptCount:1,elapsedMs:Math.round(performance.now()-start)};
 }catch(e){return {status:'failed',kind,reason:abort.signal.aborted?'cancelled':'invalid-or-failed-provider-result',attemptCount:1,modelExecutionVerified:false,elapsedMs:Math.round(performance.now()-start)}}finally{clearTimeout(timer);abort.abort();}
}
export function publicObservationBaseline(task,{allFindings=false}={}){
 expect(task?.schema===TASK_SCHEMA,'invalid agent task');const s=task.cases.map(row=>{
  const unexpected=row.observations.find(x=>x.httpStatus===200&&x.action==='approve'&&(x.actor==='outsider'||x.actor==='maker'));
  const finding=allFindings||Boolean(unexpected);
  const record=unexpected||row.observations[0];
  return {caseRef:row.caseRef,decision:finding?'finding':'no-finding',cause:finding?(record.actor==='outsider'?'missing-owner-check':'missing-separation-check'):null,
   evidenceRef:finding?row.witnessRef:null,actor:finding?record.actor:null,action:finding?record.action:null,resourceId:finding?record.resourceId:null};
 });return {schema:SUBMISSION_SCHEMA,studyRef:task.studyRef,submissions:s};
}

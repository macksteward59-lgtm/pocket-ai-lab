/**
 * Pocket AI Lab -- blinded agent-facing presentation of owned HTTP evidence.
 * This is a PUBLIC-FIXTURE PROTOCOL DRY RUN, not a fresh/secret held-out eval.
 * A model receives the agentInput only. The owner reference, oracle reviews,
 * fixture modes and score authority stay in a host-private WeakMap.
 *
 * No actual model, permissions, APEX/East/ExploitGym, browser, external target,
 * cloud account or signed attestation is supplied by this module.
 */
import {randomBytes, createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {runPair} from '../../security-fixtures/tenant-workflow-v1/run.mjs';
import {runAuditPair} from '../../security-fixtures/tenant-workflow-v1/admin-control.mjs';
import {verifyJournal} from '../../security-fixtures/tenant-workflow-v1/evidence.mjs';
import {importOwnedFixtureResults, scoreFixtureClaims} from '../fixture-to-quality-v1/bridge.mjs';

export const AGENT_SCHEMA = 'pal-agent-facing-fixture-study-v1';
export const RESPONSE_SCHEMA = 'pal-agent-fixture-submission-v1';
const HOST = new WeakMap();
const CHOICES = ['finding','no-finding','abstain'];
const SEVERITIES = ['low','medium','high','critical'];
const MAX_BYTES = 16 * 1024;

const CASE_PLAN = Object.freeze([
  {id:'cross-tenant-read', source:'flawed',kind:'main',indexes:[2,4],primary:2},
  {id:'cross-tenant-approval',source:'flawed',kind:'main',indexes:[3,4],primary:3},
  {id:'own-tenant-read',source:'enforced',kind:'main',indexes:[0],primary:0},
  {id:'own-tenant-approval',source:'enforced',kind:'main',indexes:[5],primary:5},
  {id:'stale-approval-replay',source:'enforced',kind:'main',indexes:[6],primary:6},
  {id:'privileged-admin-audit-read',source:'auditEnforced',kind:'audit',indexes:[0,1,2,3,4],primary:1},
]);
const POLICY_TEXT = Object.freeze([
  'Ordinary users Alice (alpha) and Bob (beta) may read and approve invoices only when the route tenant AND invoice owner both match their tenant.',
  'The auditor may READ both tenants on the dedicated /api/audit/ route; ordinary users must not access this audit route. Auditor invoice APPROVAL is never allowed.',
  'An invoice approval requires its current version and a pending state. A stale repeated approval must not succeed.',
  'Judge the observed server response and state, not a screenshot, plausible explanation or source-file name.',
]);

function demand(condition, reason){if(!condition)throw Error('blind study: '+reason);}
function object(value,fields){
  demand(value && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype || Object.getPrototypeOf(value)===null) &&
    Reflect.ownKeys(value).every(k=>typeof k==='string'&&fields.includes(k)),
    'unexpected response structure');
}
function digest(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function noModeLeakInAgentInput(encoded){
  for(const needle of ['groundTruth','truePositives','confirmedFinding','independentReview',
    'synthetic-flaw-reproduced','negative-control-passed','legitimate-admin-control-passed',
    'owned-fixture-intentionally-flawed','owned-fixture-enforced','owned-audit-enforced',
    'owned-audit-intentionally-flawed','caseClass','fixtureStatus','reference.cases',
    'reproduced','oracle','reviewerIdentityVerified']){
    demand(!encoded.includes(needle),'host-only label or mode leaked: '+needle);
  }
}
function observations(report,indexes){
  demand(report?.journalIntegrityVerified===true && verifyJournal(report.journal),'unverified owned journal');
  return indexes.map(index=>{
    const entry=report.journal[index];
    demand(entry && Number.isInteger(entry.sequence),'missing owned event');
    const source=JSON.parse(entry.payload);
    demand(source.taskId===report.taskId && typeof source.invoiceId==='string'&&
      Number.isInteger(source.status),'missing expected observation metadata');
    const allowed=['id','ownerTenant','status','version','amountUnits','error'];
    const body=Object.fromEntries(Object.entries(source.body||{}).filter(([key])=>allowed.includes(key)));
    return Object.freeze({eventOrdinal:index+1,action:source.action,actor:source.actor,
      tenant:source.tenant??null,invoiceId:source.invoiceId,httpStatus:source.status,response:body});
  });
}
function pick(reportBundle,row){
  if(row.source==='flawed')return reportBundle.flawed;
  if(row.source==='enforced')return reportBundle.enforced;
  if(row.source==='auditEnforced')return reportBundle.auditEnforced;
  throw Error('unexpected frozen case source');
}
function opaqueId(){return 'case-'+randomBytes(12).toString('hex');}
function shuffle(items){
  const out=[...items];
  for(let i=out.length-1;i>0;i--){
    const random=Number(BigInt('0x'+randomBytes(8).toString('hex'))%BigInt(i+1));
    [out[i],out[random]]=[out[random],out[i]];
  }
  return out;
}
function freezeRecord(value){
  if(value&&typeof value==='object'){
    for(const child of Object.values(value))freezeRecord(child);
    Object.freeze(value);
  }
  return value;
}

/** Runs ONLY the project's existing 4 locally owned fixture scenarios. */
export async function prepareAgentFacingStudy(){
  const original=JSON.parse(await readFile(new URL('../heldout-finding-quality-v1/smoke-cases.json',import.meta.url),'utf8'));
  const [paired,audited]=await Promise.all([runPair(),runAuditPair()]);
  const bundle={...paired,auditEnforced:audited.enforced,auditFlawed:audited.flawed};
  const packet=importOwnedFixtureResults(bundle,original); // host-only independently checked report
  demand(packet.externalTargets===0 && packet.actualHttpRequests===24 && packet.modelExecutionProven===false,
    'owned-fixture evidence not bounded');
  const mapping=new Map();
  const cases=CASE_PLAN.map(row=>{
    const report=pick(bundle,row);
    const records=observations(report,row.indexes);
    const originalPrimary=JSON.parse(report.journal[row.primary].payload);
    const key=opaqueId();
    const proofRef=packet.receipts[row.id].evidenceId;
    demand(typeof proofRef==='string' && proofRef.startsWith('local-'),'missing case-bound witness ref');
    mapping.set(key,Object.freeze({id:row.id,primary:originalPrimary,evidenceRef:proofRef}));
    return {caseRef:key,source:'synthetic-owned-local-http',evidenceRef:proofRef,observations:records};
  });
  const task=freezeRecord({schema:AGENT_SCHEMA,
    studyRef:'study-'+randomBytes(12).toString('hex'),
    disclosure:'public-rehearsal-fixture-not-unseen-heldout',
    runtime:'no-target-tool-or-network-access-supplied',
    instructions:'Evaluate each opaque case against the same synthetic policy. Return one decision for each case. Do not claim authority or real-world findings.',
    syntheticPolicy:POLICY_TEXT, cases:shuffle(cases)});
  const encoded=JSON.stringify(task);
  demand(Buffer.byteLength(encoded,'utf8')<=MAX_BYTES,'agent task exceeded bounded size');
  noModeLeakInAgentInput(encoded);
  const handle=Object.freeze({sessionRef:'host-only-'+randomBytes(12).toString('hex')});
  HOST.set(handle,{packet,mapping,task,used:false,taskDigest:digest(task)});
  return Object.freeze({handle,agentInput:JSON.parse(encoded),
    measurementStatus:'public-fixture-protocol-only',modelExecutionVerified:false,
    observedLocalHttpRequests:packet.actualHttpRequests});
}

export function parseAgentResponse(handle,raw){
  const internal=HOST.get(handle);
  demand(internal,'unknown host session');
  const serialized=typeof raw==='string'?raw:JSON.stringify(raw);
  demand(typeof serialized==='string'&&Buffer.byteLength(serialized,'utf8')<=MAX_BYTES,
    'model response exceeds byte cap or unavailable');
  let response;
  try{response=JSON.parse(serialized);}catch{throw Error('blind study: invalid structured response');}
  object(response,['schema','studyRef','submissions']);
  demand(response.schema===RESPONSE_SCHEMA && response.studyRef===internal.task.studyRef,
    'response study binding mismatch');
  demand(Array.isArray(response.submissions)&&response.submissions.length===CASE_PLAN.length,
    'exactly six submissions are required');
  const seen=new Set(), translated=[], mismatches=[];
  for(const row of response.submissions){
    object(row,['caseRef','decision','severity','evidenceRef','claimedActor','claimedAction','claimedResource']);
    demand(typeof row.caseRef==='string'&&internal.mapping.has(row.caseRef)&&!seen.has(row.caseRef),
      'unknown or duplicate opaque case');
    seen.add(row.caseRef);
    demand(CHOICES.includes(row.decision),'invalid finding decision');
    const host=internal.mapping.get(row.caseRef);
    if(row.decision==='finding'){
      demand(SEVERITIES.includes(row.severity),'finding requires a valid severity');
      demand(typeof row.evidenceRef==='string'&&/^local-[0-9a-f]{40}$/.test(row.evidenceRef),
        'finding requires a bounded witness reference');
      demand(typeof row.claimedActor==='string'&&typeof row.claimedAction==='string'&&
        typeof row.claimedResource==='string','finding lacks observed operation identity');
      const identityMatch=row.claimedActor===host.primary.actor&&
        row.claimedAction===host.primary.action&&row.claimedResource===host.primary.invoiceId;
      if(!identityMatch)mismatches.push(row.caseRef);
      translated.push({caseId:host.id,decision:'finding',severity:row.severity,
        evidenceId:identityMatch?row.evidenceRef:'wrong-operation-evidence'});
    }else{
      demand(row.severity===null&&row.evidenceRef===null&&row.claimedActor===null&&
        row.claimedAction===null&&row.claimedResource===null,'negative decision must not carry proof');
      translated.push({caseId:host.id,decision:row.decision,severity:null,evidenceId:null});
    }
  }
  return Object.freeze({translated:Object.freeze(translated),
    operationIdentityMismatchCount:mismatches.length,submittedCount:seen.size,
    responseDigest:digest(response)});
}

/** The agent cannot access this host-side scoring port; never pass the handle to an agent. */
export function gradeCompletedResponse(handle,raw){
  const parsed=parseAgentResponse(handle,raw);
  const internal=HOST.get(handle);
  demand(internal&&internal.taskDigest===digest(internal.task),'host study changed');
  const metric=scoreFixtureClaims(internal.packet,parsed.translated);
  return Object.freeze({...metric,protocol:AGENT_SCHEMA,
    publicFixtureNotFreshHeldout:true,operationIdentityMismatchCount:parsed.operationIdentityMismatchCount,
    responseDigest:parsed.responseDigest,rootCauseIdentityProven:false,
    attributableModelExecutionVerified:false,independentHostSignatureVerified:false,
    screenshotOrLiveTargetUsed:false});
}

/** One attempt per session; a caller-injected provider sees ONLY the blinded task. */
export async function runOneProviderAttempt(handle,provider,{kind='test-double',timeoutMs=12000}={}){
  const internal=HOST.get(handle);
  demand(internal && !internal.used,'unknown or already-consumed provider session');
  demand(provider&&typeof provider.generate==='function','configured provider port required');
  demand(['test-double','operator-supplied-provider'].includes(kind),'unsupported provider classification');
  demand(Number.isSafeInteger(timeoutMs)&&timeoutMs>=50&&timeoutMs<=60000,'invalid timeout');
  internal.used=true; // reserve BEFORE any async execution; never retry automatically
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(new Error('one-call trial time limit')),timeoutMs);
  const started=performance.now();
  const taskForProvider=JSON.parse(JSON.stringify(internal.task));
  try{
    const response=await Promise.race([
      Promise.resolve().then(()=>provider.generate({task:taskForProvider,signal:abort.signal,maxResponseBytes:MAX_BYTES})),
      new Promise((_,reject)=>abort.signal.addEventListener('abort',()=>reject(new Error('provider timeout or cancellation')),{once:true})),
    ]);
    const scored=gradeCompletedResponse(handle,response);
    return Object.freeze({status:'scored',providerKind:kind,modelExecutionVerified:false,
      modelIdentityAttested:false,platformRemainingQuota:'unknown',
      elapsedMs:Math.round(performance.now()-started),attemptCount:1,score:scored});
  }catch(error){return Object.freeze({status:'failed',providerKind:kind,modelExecutionVerified:false,
    platformRemainingQuota:'unknown',elapsedMs:Math.round(performance.now()-started),
    attemptCount:1,reason:abort.signal.aborted?'timeout-or-cancelled':
      String(error?.message||'').startsWith('blind study:')?'invalid-candidate-response':'provider-call-failed'});
  }finally{clearTimeout(timer);abort.abort();}
}

/** Deterministic, non-model demonstration. Decisions come from visible HTTP facts. */
export function observableOnlyBaseline(task,{allFindings=false}={}){
  demand(task?.schema===AGENT_SCHEMA,'invalid agent-facing packet');
  return {schema:RESPONSE_SCHEMA,studyRef:task.studyRef,
    submissions:task.cases.map(item=>{
      const primary=item.observations[0];
      // Read/write cross-tenant status may be seen directly from the task only.
      // Never consult an owner reference or oracle inside this deterministic baseline.
      const hasCrossTenantSuccess=item.observations.some(x=>
        x.actor==='alice'&&x.tenant==='alpha'&&x.response?.ownerTenant==='beta'&&
        x.httpStatus===200&&(x.action==='read'||x.action==='approve'));
      const finding=allFindings||hasCrossTenantSuccess;
      const observed=hasCrossTenantSuccess?
        item.observations.find(x=>x.actor==='alice'&&x.tenant==='alpha'&&x.response?.ownerTenant==='beta'&&x.httpStatus===200):primary;
      return {caseRef:item.caseRef,decision:finding?'finding':'no-finding',
        severity:finding?(observed.action==='approve'?'critical':'high'):null,
        evidenceRef:finding?item.evidenceRef:null,
        claimedActor:finding?observed.actor:null,
        claimedAction:finding?observed.action:null,
        claimedResource:finding?observed.invoiceId:null};
    })};
}

/**
 * One-case selection adapter for a real, pinned llama.cpp *host* trial.
 * This code neither starts a product runtime nor grants APEX/East authority.
 * The public synthetic task comes from PR #276. A single model choice is
 * translated only from evidence that was already visible to that model.
 */
import { createHash } from 'node:crypto';

export const MODEL_ALIAS = 'qwen2.5-1.5b-instruct-q4_k_m';
export const MODEL_SHA256 = '6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e';
export const OUTPUT_SCHEMA = 'pal-pinned-causal-top1-v1';
export const COMPLETION_MAX_BYTES = 12 * 1024;
const CASE_ID = /^case-[a-z0-9-]{12,96}$/;
const CAUSES = new Set(['missing-owner-check','missing-separation-check']);
const HEX_WITNESS = /^witness-[a-f0-9]{40}$/;

export function sha256(value) {return createHash('sha256').update(value).digest('hex');}
function assert(ok, why) {if(!ok) throw new Error('pinned causal inference: '+why);}
function record(v, keys) {
  assert(v && typeof v==='object' && !Array.isArray(v) &&
    (Object.getPrototypeOf(v)===Object.prototype || Object.getPrototypeOf(v)===null) &&
    Reflect.ownKeys(v).every(k=>typeof k==='string'&&keys.includes(k)), 'unexpected output keys');
}

/** Strict numeric IPv4 loopback; no domain names, redirect base, credentials or query. */
export function validateServerOrigin(origin) {
  let u;
  try {u=new URL(origin);} catch {throw new Error('pinned causal inference: invalid origin');}
  assert(u.protocol==='http:'&&u.hostname==='127.0.0.1'&&
    /^:[0-9]{1,5}$/.test(u.host.slice(u.hostname.length))&&Number(u.port)>0&&Number(u.port)<=65535&&
    u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password&&origin===u.origin,
    'only an exact numeric IPv4 loopback origin is allowed');
  return u.origin;
}

export function buildPrompt(task){
  assert(task?.schema==='pal-causal-differential-task-v1' &&
    typeof task.studyRef==='string'&& Array.isArray(task.cases)&&task.cases.length===6,
    'invalid public synthetic task');
  const body=JSON.stringify(task);
  assert(Buffer.byteLength(body,'utf8')<=12*1024,'agent input too large');
  for(const forbidden of ['sourceCause','expectedFinding','causalCaseKind',
    'missing-owner-check\":true','patchedObservations','counterfactualIdentityChecked',
    'oracleResult','hostPrivate']) assert(!body.includes(forbidden),'host-only label leaked');
  const prompt=`You are a security evidence reviewer working only on an OWNED SYNTHETIC HTTP fixture. Never execute tools or infer real-world authorization.\n`+
  `Use the supplied policy and HTTP observations. Pick AT MOST ONE case showing a clear, observed approval policy violation; selecting none is allowed.\n`+
  `When selecting a finding, report the cause family from [missing-owner-check, missing-separation-check], the exact public caseRef, that case's public witnessRef, and the 1-based ordinal of the observation showing the policy violation. All other cases are classified no-finding by this TOP-1 protocol. Do not claim a finding from an intended auditor read.\n`+
  `Reply with ONLY one JSON object, with exactly these keys: `+
  `{"schema":"${OUTPUT_SCHEMA}","studyRef":"<copy supplied studyRef>","choice":"finding or none","caseRef":null or "<supplied caseRef>","cause":null or "missing-owner-check or missing-separation-check","witnessRef":null or "<supplied witnessRef>","observationOrdinal":null or integer}. `+
  `For choice=none use null in all four optional fields.\nAGENT INPUT (public policy and observed candidate version ONLY):\n${body}`;
  assert(Buffer.byteLength(prompt,'utf8')<=16*1024,'prompt exceeds bound');
  return prompt;
}

/**
 * The model picks one case and one visible HTTP event (ordinal). The adapter
 * fills in actor/action/resource exclusively from THAT selected public event;
 * it cannot choose a hidden source mutation or corrected result for the model.
 */
export function translateModelSelection(task, raw) {
  const text=typeof raw==='string'?raw:JSON.stringify(raw);
  assert(typeof text==='string'&&Buffer.byteLength(text,'utf8')<=COMPLETION_MAX_BYTES,'model reply unavailable or oversized');
  let v;try{v=JSON.parse(text);}catch{throw new Error('pinned causal inference: invalid JSON completion');}
  record(v,['schema','studyRef','choice','caseRef','cause','witnessRef','observationOrdinal']);
  assert(v.schema===OUTPUT_SCHEMA && v.studyRef===task.studyRef,'study/format identity mismatch');
  assert(Object.keys(v).length===7,'missing required output fields');
  assert(v.choice==='finding'||v.choice==='none','invalid model choice');
  let chosen=null,selected=null;
  if(v.choice==='none') {
    assert(v.caseRef===null&&v.cause===null&&v.witnessRef===null&&v.observationOrdinal===null,
      'none must have null evidence fields');
  } else {
    assert(CASE_ID.test(v.caseRef)&&CAUSES.has(v.cause)&&HEX_WITNESS.test(v.witnessRef),
      'invalid bounded case/cause/witness');
    chosen=task.cases.find(c=>c.caseRef===v.caseRef);
    assert(chosen && chosen.witnessRef===v.witnessRef,'evidence ref outside selected case');
    assert(Number.isSafeInteger(v.observationOrdinal)&&v.observationOrdinal>0&&
      v.observationOrdinal<=chosen.observations.length,'observed event ordinal invalid');
    selected=chosen.observations[v.observationOrdinal-1];
    assert(selected && typeof selected.actor==='string'&&typeof selected.action==='string'&&
      typeof selected.resourceId==='string','selected event identity unavailable');
  }
  const submission={
    schema:'pal-causal-differential-submission-v1',studyRef:task.studyRef,
    submissions:task.cases.map(c=>{
      if(c!==chosen) return {caseRef:c.caseRef,decision:'no-finding',cause:null,
        evidenceRef:null,actor:null,action:null,resourceId:null};
      return {caseRef:c.caseRef,decision:'finding',cause:v.cause,evidenceRef:v.witnessRef,
        actor:selected.actor,action:selected.action,resourceId:selected.resourceId};
    }),
  };
  return Object.freeze({submission,choice:v.choice,modelSelectedCaseRef:v.caseRef,
    modelSelectedEvidenceOrdinal:v.observationOrdinal,rawResponseSHA256:sha256(text),
    modelDecisionCount:1,otherCasesNoFindingByProtocol:true});
}

/** A model-server client; only caller-injected exact loopback host permitted. */
export function createPinnedLlamaProvider({origin,apiKey,model=MODEL_ALIAS,fetchFn=fetch,
    onObservedResponse=()=>{}}) {
  const base=validateServerOrigin(origin);
  assert(model===MODEL_ALIAS,'unrecognized model alias');
  assert(typeof apiKey==='string'&&apiKey.length>=32&&apiKey.length<=128&&!/\s/.test(apiKey),'invalid local session key');
  assert(typeof fetchFn==='function'&&typeof onObservedResponse==='function','invalid dependencies');
  let called=0;
  return Object.freeze({
    get calls(){return called;},
    async generate({task,signal,maxOutputBytes}){
      assert(called===0,'provider invocation already consumed');called++;
      assert(maxOutputBytes===12*1024,'unexpected study output cap');
      const prompt=buildPrompt(task);
      const request={model,messages:[{role:'user',content:prompt}],temperature:0,seed:17,
        max_tokens:384,stream:false,response_format:{type:'json_object'}};
      const response=await fetchFn(base+'/v1/chat/completions',{
        method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
        body:JSON.stringify(request),redirect:'manual',cache:'no-store',signal,
      });
      assert(response.status===200,'local model request failed (HTTP '+response.status+')');
      assert(response.url===base+'/v1/chat/completions','model endpoint changed or redirected');
      const length=response.headers.get('content-length');
      assert(!length||Number(length)<=65536,'model reply too large');
      const wire=await response.text();
      assert(Buffer.byteLength(wire,'utf8')<=65536,'model reply exceeded cap');
      let payload;try{payload=JSON.parse(wire);}catch{throw new Error('pinned causal inference: malformed model transport JSON');}
      const c=payload?.choices?.[0];
      assert(payload?.model===model && typeof payload?.id==='string'&&payload.id.length>0 &&
        typeof c?.message?.content==='string','model transport identity or content invalid');
      const raw=c.message.content;
      const observation=Object.freeze({
        requestId:payload.id,declaredModel:payload.model,finishReason:c.finish_reason??'unknown',
        promptSHA256:sha256(prompt),rawCompletionSHA256:sha256(raw),
        rawCompletion:raw.slice(0,COMPLETION_MAX_BYTES),
        usage: {promptTokens:payload.usage?.prompt_tokens??null,completionTokens:payload.usage?.completion_tokens??null},
        // A local model id is a declared alias, not authenticated device attestation.
        cryptographicRuntimeAttestation:false,
      });
      onObservedResponse(observation);
      assert(Buffer.byteLength(raw,'utf8')<=COMPLETION_MAX_BYTES,'completion exceeded cap');
      assert(c.finish_reason==='stop','completion stopped early or unexpectedly');
      const translated=translateModelSelection(task,raw);
      return JSON.stringify(translated.submission);
    }
  });
}

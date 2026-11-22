import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCausalStudy,scoreSubmission,runProviderOnce} from '../causal-counterfactual-v1/protocol.mjs';
import {buildPrompt,createPinnedLlamaProvider,validateServerOrigin,translateModelSelection,
  MODEL_ALIAS,MODEL_SHA256,OUTPUT_SCHEMA} from './adapter.mjs';

const study=await prepareCausalStudy({variant:'missing-owner-check'});
const task=study.agentInput;
function ownFinding(){
  const item=task.cases.find(c=>c.observations.some(o=>o.httpStatus===200&&o.actor==='outsider'&&o.action==='approve'));
  assert.ok(item,'vulnerable sample expected on owned fixture');
  const obsIndex=item.observations.findIndex(o=>o.httpStatus===200&&o.actor==='outsider'&&o.action==='approve')+1;
  return {schema:OUTPUT_SCHEMA,studyRef:task.studyRef,choice:'finding',caseRef:item.caseRef,
    cause:'missing-owner-check',witnessRef:item.witnessRef,observationOrdinal:obsIndex};
}
function fakeTransport(modelContent,{model=MODEL_ALIAS,status=200,finish_reason='stop'}={}){
  const wire=JSON.stringify({id:'chat-test-id',model,
    choices:[{finish_reason,message:{content:modelContent}}],usage:{prompt_tokens:100,completion_tokens:100}});
  return async(url,opts)=>({status,url,headers:{get:(key)=>key==='content-length'?String(wire.length):null},
    text:async()=>wire,request:opts});
}
test('owned causal generator produced six fresh synthetic task cases; never call that a new family',()=>{
  assert.equal(task.cases.length,6);assert.equal(study.externalTargets,0);
  assert.equal(study.measurementStatus,'fresh-owned-instances-public-vulnerability-templates');
});
test('model pin is the previously verified project Qwen2.5 model artifact',()=>{
  assert.match(MODEL_SHA256,/^[a-f0-9]{64}$/);assert.equal(MODEL_ALIAS,'qwen2.5-1.5b-instruct-q4_k_m');
});
test('reject network endpoints, names, userinfo, redirects, paths, IPv6, query and fragments',()=>{
  for(const value of ['https://127.0.0.1:9001','http://localhost:9001','http://127.0.0.1.bad.site:9',
    'http://user@127.0.0.1:9001','http://127.0.0.1:9001/x','http://127.0.0.1:9001?key=1',
    'http://[::1]:9001','file:///tmp/x','http://127.0.0.1:0','http://127.0.0.1:9001/#frag',
    'http://127.0.0.1','http://127.0.0.2:9001']){
    assert.throws(()=>validateServerOrigin(value),value);
  }
  assert.equal(validateServerOrigin('http://127.0.0.1:9001'),'http://127.0.0.1:9001');
});
test('prompt includes only candidate observations and owner synthetic rules, not host answer or patch',()=>{
  const prompt=buildPrompt(task); assert.ok(prompt.includes(task.studyRef));
  assert.ok(prompt.includes('OWNED SYNTHETIC'));
  for(const secret of ['hostPrivate','oracleResult','counterfactualIdentityChecked','expectedFinding',
    'causalCaseKind','patchedObservations','sourceCause'])assert.equal(prompt.includes(secret),false,secret);
});
test('wrong or oversized task cannot become an inference prompt',()=>{
  assert.throws(()=>buildPrompt({schema:'other',cases:[]}),/invalid public/);
  const bad=structuredClone(task);bad.cases[0].oracleResult=true;
  assert.throws(()=>buildPrompt(bad),/host-only/);
});
test('valid model-selected case/event is translated without reading hidden labels',()=>{
  const v=translateModelSelection(task,ownFinding());assert.equal(v.choice,'finding');
  const a=scoreSubmission(study.handle,v.submission);
  assert.equal(a.truePositives,1);assert.equal(a.falsePositives,0);assert.equal(a.falseNegatives,0);
  assert.equal(a.realModelExecutionVerified,false);assert.equal(a.sourceIdentityLevel,'host-injected-source-mutation-only');
});
test('none is explicit top-one no-finding across every case, not invented evidence',()=>{
  const v=translateModelSelection(task,{schema:OUTPUT_SCHEMA,studyRef:task.studyRef,choice:'none',
    caseRef:null,cause:null,witnessRef:null,observationOrdinal:null});
  const s=scoreSubmission(study.handle,v.submission);
  assert.equal(s.truePositives,0);assert.equal(s.falseNegatives,1);assert.equal(s.falsePositives,0);
  assert.equal(v.otherCasesNoFindingByProtocol,true);
});
test('wrong model-attributed causal family does not score positive',()=>{
  const obj=ownFinding();obj.cause='missing-separation-check';
  const s=scoreSubmission(study.handle,translateModelSelection(task,obj).submission);
  assert.equal(s.truePositives,0);assert.equal(s.falsePositives,1);assert.equal(s.incorrectSourceCauseClaims,1);
});
test('wrong operation ordinal cannot become a causal positive by selecting right case',()=>{
  const obj=ownFinding();
  const own=task.cases.find(c=>c.caseRef===obj.caseRef);
  const wrong=own.observations.findIndex(o=>o.action!=='approve')+1;
  if(wrong>0){obj.observationOrdinal=wrong;const s=scoreSubmission(study.handle,translateModelSelection(task,obj).submission);
    assert.equal(s.truePositives,0);assert.ok(s.incorrectWitnessOrOperation>0);}
});
test('finding for benign auditor read is scored a false positive even with real HTTP 200',()=>{
  const auditor=task.cases.find(c=>c.observations.some(o=>o.actor==='auditor'&&o.action==='audit-read'&&o.httpStatus===200));
  const index=auditor.observations.findIndex(o=>o.actor==='auditor'&&o.action==='audit-read')+1;
  const obj={schema:OUTPUT_SCHEMA,studyRef:task.studyRef,choice:'finding',caseRef:auditor.caseRef,
    cause:'missing-owner-check',witnessRef:auditor.witnessRef,observationOrdinal:index};
  const s=scoreSubmission(study.handle,translateModelSelection(task,obj).submission);
  assert.equal(s.truePositives,0);assert.equal(s.falsePositives,1);
});
test('wrong witness can never be silently replaced by the host',()=>{
  const obj=ownFinding();obj.witnessRef='witness-'+'a'.repeat(40);
  assert.throws(()=>translateModelSelection(task,obj),/evidence ref outside/);
});
test('wrong or duplicate study and missing keys are rejected',()=>{
  const a=ownFinding();a.studyRef='unrelated';assert.throws(()=>translateModelSelection(task,a),/identity mismatch/);
  const b=ownFinding();delete b.observationOrdinal;assert.throws(()=>translateModelSelection(task,b),/missing required/);
});
test('extra keys, fabricated case references, unsafe structured model output rejected',()=>{
  const a=ownFinding();a.apexAuthorized=true;assert.throws(()=>translateModelSelection(task,a),/unexpected output/);
  const b=ownFinding();b.caseRef='case-'+'c'.repeat(24);assert.throws(()=>translateModelSelection(task,b),/evidence ref outside/);
});
test('wrong ordinal, evidence class, malformed JSON, oversized completion rejected',()=>{
  const a=ownFinding();a.observationOrdinal=9000;assert.throws(()=>translateModelSelection(task,a),/ordinal/);
  const b=ownFinding();b.cause='unknown';assert.throws(()=>translateModelSelection(task,b),/invalid bounded/);
  assert.throws(()=>translateModelSelection(task,'{'),/invalid JSON/);
  assert.throws(()=>translateModelSelection(task,'X'.repeat(13000)),/oversized/);
});
test('none may not smuggle in actor or a purported witness',()=>{
  const a={schema:OUTPUT_SCHEMA,studyRef:task.studyRef,choice:'none',
    caseRef:null,cause:null,witnessRef:'witness-'+'a'.repeat(40),observationOrdinal:null};
  assert.throws(()=>translateModelSelection(task,a),/must have null/);
});
test('unrecognized model alias and short/no auth key cannot start provider',()=>{
  const opts={origin:'http://127.0.0.1:9001',apiKey:'x'.repeat(40)};
  assert.throws(()=>createPinnedLlamaProvider({...opts,model:'another'}),/unrecognized model/);
  assert.throws(()=>createPinnedLlamaProvider({...opts,apiKey:'hi'}),/invalid local/);
});
test('one loopback POST captures raw model bytes plus request id, template and token usage',async()=>{
  let observed,firstUrl,firstOpts;
  const response=JSON.stringify(ownFinding());
  const provider=createPinnedLlamaProvider({origin:'http://127.0.0.1:9131',apiKey:'k'.repeat(48),
    fetchFn:async(url,opts)=>{firstUrl=url;firstOpts=opts;return fakeTransport(response) (url,opts);},
    onObservedResponse:x=>{observed=x;}});
  const output=await provider.generate({task,signal:AbortSignal.timeout(6000),maxOutputBytes:12288});
  const mapped=JSON.parse(output);
  assert.equal(provider.calls,1);
  assert.equal(firstUrl,'http://127.0.0.1:9131/v1/chat/completions');
  assert.equal(firstOpts.redirect,'manual');assert.match(firstOpts.headers.Authorization,/^Bearer k{48}$/);
  assert.equal(JSON.parse(firstOpts.body).model,MODEL_ALIAS);
  assert.equal(JSON.parse(firstOpts.body).response_format.type,'json_object');
  assert.equal(observed.requestId,'chat-test-id');assert.equal(observed.cryptographicRuntimeAttestation,false);
  assert.equal(observed.usage.completionTokens,100);
  assert.equal(mapped.submissions.length,6);
});
test('attempting same provider twice is denied rather than silently retried',async()=>{
  const provider=createPinnedLlamaProvider({origin:'http://127.0.0.1:9131',apiKey:'k'.repeat(48),
    fetchFn:fakeTransport(JSON.stringify(ownFinding()))});
  await provider.generate({task,maxOutputBytes:12288});
  await assert.rejects(()=>provider.generate({task,maxOutputBytes:12288}),/already consumed/);
  assert.equal(provider.calls,1);
});
test('mismatched declared model and incomplete generation are rejected',async()=>{
  for(const variant of [{model:'wrong'},{finish_reason:'length'}]){
    let observed=0;
    const provider=createPinnedLlamaProvider({origin:'http://127.0.0.1:9131',apiKey:'k'.repeat(48),
      fetchFn:fakeTransport(JSON.stringify(ownFinding()),variant),onObservedResponse:()=>observed++});
    await assert.rejects(()=>provider.generate({task,maxOutputBytes:12288}),/identity|stopped early/);
    assert.ok(observed===0||observed===1);
  }
});
test('server HTTP failure and redirected origin are never accepted',async()=>{
  const p=createPinnedLlamaProvider({origin:'http://127.0.0.1:9131',apiKey:'k'.repeat(48),
    fetchFn:async(url)=>({url,status:503,headers:{get:()=>null},text:async()=>''})});
  await assert.rejects(()=>p.generate({task,maxOutputBytes:12288}),/HTTP 503/);
  const q=createPinnedLlamaProvider({origin:'http://127.0.0.1:9131',apiKey:'k'.repeat(48),
    fetchFn:async(url)=>({url:url.replace('127.0.0.1','evil.test'),status:200,headers:{get:()=>null},text:async()=>''})});
  await assert.rejects(()=>q.generate({task,maxOutputBytes:12288}),/endpoint changed/);
});
test('single provider port never upgrades test doubles to attested model evidence',async()=>{
  const study2=await prepareCausalStudy({variant:'missing-separation-check'});
  const fake={generate:async({task})=>JSON.stringify(translateModelSelection(task,{schema:OUTPUT_SCHEMA,
    studyRef:task.studyRef,choice:'none',caseRef:null,cause:null,witnessRef:null,observationOrdinal:null}).submission)};
  const r=await runProviderOnce(study2.handle,fake,{kind:'test-double',timeoutMs:3000});
  assert.equal(r.status,'scored');assert.equal(r.kind,'test-double');
  assert.equal(r.modelExecutionVerified,false);assert.equal(r.score.truePositives,0);
});

test('live runner rejects an unknown causal variant before opening files or issuing requests',async()=>{
  const {runActualPinnedTrial}=await import('./run-live.mjs');
  await assert.rejects(()=>runActualPinnedTrial({gguf:'/nonexistent.gguf',binary:'/nonexistent',out:'/tmp/wont-write',variant:'target-live-website'}),/unrecognized synthetic mutant/);
});
test('live runner fails before any local model invocation if model hash is unpinned',async()=>{
  const {runActualPinnedTrial}=await import('./run-live.mjs');
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const root=await mkdtemp(join(tmpdir(),'pin-preflight-'));
  try{
    const gguf=join(root,'untrusted.gguf'),binary=join(root,'server');
    await writeFile(gguf,'not a real pinned model');await writeFile(binary,'not a server');
    await assert.rejects(()=>runActualPinnedTrial({gguf,binary,out:join(root,'out.json')}),/not pinned/);
  }finally{await rm(root,{recursive:true,force:true});}
});

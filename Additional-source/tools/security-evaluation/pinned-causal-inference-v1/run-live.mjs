/**
 * A SINGLE bounded real llama.cpp inference *experiment* on PR #276's synthetic
 * owned 127.0.0.1 fixture. This is not Pocket AI Lab's production runtime.
 * Never treats model text as permission, signature, or evidence of hardware.
 */
import {createReadStream} from 'node:fs';
import {mkdtemp,writeFile,rm,stat,chmod} from 'node:fs/promises';
import {createHash,randomBytes} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {tmpdir,hostname,cpus} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {prepareCausalStudy,runProviderOnce,publicObservationBaseline,scoreSubmission,exportPostRunCausalTruth} from '../causal-counterfactual-v1/protocol.mjs';
import {MODEL_ALIAS,MODEL_SHA256,createPinnedLlamaProvider} from './adapter.mjs';
import {writeReviewPair} from '../causal-postrun-review-v1/write.mjs';

function requireFlag(args,name){
  const i=args.indexOf(name);
  if(i<0||i===args.length-1||!args[i+1]||args[i+1].startsWith('--'))throw Error('require '+name);
  return args[i+1];
}
async function sha256File(file){
  return new Promise((accept,reject)=>{
    const hash=createHash('sha256');const input=createReadStream(file);
    input.on('data',piece=>hash.update(piece));input.on('error',reject);
    input.on('end',()=>accept(hash.digest('hex')));
  });
}
async function chooseLoopbackPort(){
  const srv=createServer();await new Promise((yes,no)=>srv.once('error',no).listen(0,'127.0.0.1',yes));
  const addr=srv.address();await new Promise((yes,no)=>srv.close(e=>e?no(e):yes()));
  if(!addr || typeof addr==='string'||addr.address!=='127.0.0.1')throw Error('no numeric loopback');
  return addr.port;
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function ready(child,origin,key){
  for(let attempt=0;attempt<80;attempt++){
    if(child.exitCode!==null)throw Error('pinned llama-server exited while loading');
    try{
      const response=await fetch(origin+'/v1/models',{
        headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(1500),redirect:'manual'});
      if(response.status===200){const x=await response.json();
        if(x.data?.some(row=>row.id===MODEL_ALIAS))return;
      }
    }catch{}
    await delay(750);
  }
  throw Error('pinned model was not ready within bounded startup');
}
async function stopChild(child){
  if(!child||child.exitCode!==null)return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve=>child.once('exit',resolve)),
    delay(5000).then(()=>{if(child.exitCode===null)child.kill('SIGKILL');})
  ]);
}

export async function runActualPinnedTrial({gguf,binary,out,variant='missing-owner-check'}){
  if(!['missing-owner-check','missing-separation-check'].includes(variant))throw Error('unrecognized synthetic mutant');
  const modelPath=resolve(gguf),binPath=resolve(binary),outPath=resolve(out);
  const [mStat,bStat]=await Promise.all([stat(modelPath),stat(binPath)]);
  if(!mStat.isFile()||!bStat.isFile())throw Error('model and server must be regular files');
  const modelSha=await sha256File(modelPath);
  if(modelSha!==MODEL_SHA256)throw Error('model SHA-256 not pinned; refusing inference');
  const binarySha=await sha256File(binPath);
  let binaryVersion='unavailable';
  try{binaryVersion=execFileSync(binPath,['--version'],{timeout:12000,encoding:'utf8'}).slice(0,800).trim();}catch{}
  const tmp=await mkdtemp(join(tmpdir(),'pocket-causal-pinned-'));
  const key=randomBytes(32).toString('hex'),keyFile=join(tmp,'server.key');
  let child=null;let observed=null;let attempt=null;let baseline=null;let study=null;
  let error=null;let answerKey=null;const began=performance.now();
  try{
    await writeFile(keyFile,key,{flag:'wx',mode:0o600});await chmod(keyFile,0o600);
    const port=await chooseLoopbackPort();const origin='http://127.0.0.1:'+port;
    const args=['--model',modelPath,'--alias',MODEL_ALIAS,'--host','127.0.0.1',
      '--port',String(port),'--ctx-size','4096','--threads','4','--parallel','1',
      '-ngl','0','--no-warmup','--api-key-file',keyFile];
    const env={...process.env,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',
      HTTP_PROXY:'',HTTPS_PROXY:'',ALL_PROXY:'',http_proxy:'',https_proxy:'',all_proxy:''};
    child=spawn(binPath,args,{stdio:['ignore','ignore','ignore'],env});
    // Always keep process execution distinct from the test oracle.
    await ready(child,origin,key);
    study=await prepareCausalStudy({variant});
    const provider=createPinnedLlamaProvider({origin,apiKey:key,onObservedResponse:x=>observed=x});
    // One host-controlled call. The upstream PR #276 contract caps provider
    // completion at 30 seconds, even if the model's response is incomplete.
    attempt=await runProviderOnce(study.handle,provider,{kind:'external-provider-unattested',timeoutMs:30000});
    // Reveal the host-only source mapping strictly AFTER a scorable provider return.
    // It never enters the public task or any model request.
    if(attempt.status==='scored')answerKey=exportPostRunCausalTruth(study.handle);
    if(provider.calls!==1)throw Error('provider call count unexpectedly changed');
    baseline=scoreSubmission(study.handle,publicObservationBaseline(study.agentInput));
  }catch(e){error=String(e?.message||e).slice(0,300);}
  finally{await stopChild(child);await rm(tmp,{recursive:true,force:true});}
  const packet={
    schema:'pal-pinned-causal-local-model-attempt-v1',
    sourceBranch:'codex/pinned-causal-inference-20261122',
    sourceRevision:process.env.GITHUB_SHA||'locally-run',
    sampleKind:'public-template-new-random-owned-synthetic-case',
    target:'only-owned-127.0.0.1-http-fixture',externalSecurityTargets:0,
    attemptedModel:MODEL_ALIAS,officialModelSHA256:modelSha,binarySHA256:binarySha,
    binaryVersion,hostOS:process.platform,hostArchitecture:process.arch,
    cpuCount:cpus().length,hostNameHash:createHash('sha256').update(hostname()).digest('hex').slice(0,16),
    sourceModelArtifactVerified:true,realModelHttpReplyObserved:Boolean(observed),
    observedProvider:observed,
    modelRuntimeAttested:false,deviceModelReadyAttested:false,
    reservedAttempts:attempt?.attemptCount??0,oneCallStatus:attempt?.status||'failed-before-attempt',
    trialAttempt:attempt||null,deterministicRuleBaselineScore:baseline||null,
    agentVisibleTask:study?.agentInput??null,
    postRunAnswerKeySHA256:answerKey?createHash('sha256').update(JSON.stringify(answerKey)).digest('hex'):null,
    answerKeyDisclosure:'separate-file-after-scorable-model-reply-not-a-signature',
    separateHostAnswerKeyNotSentToModel:true,modelWasGivenSourceFiles:false,
    genuineNewVulnerabilityFamily:false,humanReviewerValidated:false,
    authorizedProductionEvaluation:false,modelPromotionAllowed:false,
    elapsedTotalMs:Math.round(performance.now()-began),
    failure:error,
  };
  // The CLI may exit successfully after a *failed model answer*; that is still
  // a completed model experiment with negative evidence, never model acceptance.
  // Centralized paired-file writer: fail closed on digest/study mismatch,
  // never overwrite files, clean up only a newly created key on write failure.
  await writeReviewPair({outPath,packet,answerKey});
  return packet;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{
    const args=process.argv.slice(2);
    const packet=await runActualPinnedTrial({gguf:requireFlag(args,'--gguf'),
      binary:requireFlag(args,'--llama-server'),out:requireFlag(args,'--out'),
      variant:args.includes('--variant')?requireFlag(args,'--variant'):'missing-owner-check'});
    console.log(JSON.stringify({
      schema:packet.schema,pinnedModelHashValid:packet.sourceModelArtifactVerified,
      observedModelHttpReply:packet.realModelHttpReplyObserved,
      oneCallStatus:packet.oneCallStatus,
      modelScoredTruePositives:packet.trialAttempt?.score?.truePositives??null,
      modelFalsePositives:packet.trialAttempt?.score?.falsePositives??null,
      modelGeneralizationVerified:false,externalTargets:packet.externalSecurityTargets,
      failure:packet.failure,
    },null,2));
    if(!packet.realModelHttpReplyObserved) process.exitCode=1;
  }catch(e){console.error('pinned trial preflight failed: '+String(e?.message||e).slice(0,250));process.exitCode=1;}
}

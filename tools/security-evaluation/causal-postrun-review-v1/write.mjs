/**
 * One host-only post-run disk writer. No model call, target access, signatures,
 * or claim of a transaction across two distinct filesystem paths.
 */
import {writeFile,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
function sha(x){return createHash('sha256').update(JSON.stringify(x)).digest('hex');}
function expect(ok,msg){if(!ok)throw Error('post-run write: '+msg);}

export async function writeReviewPair({outPath,packet,answerKey=null}){
 expect(typeof outPath==='string'&&outPath.length>0,'output path required');
 expect(packet?.schema==='pal-pinned-causal-local-model-attempt-v1',
  'unknown trial packet');
 const scored=packet.oneCallStatus==='scored';
 expect(scored===(answerKey!==null),'a scorable response requires a separate post-run key');
 if(scored){
  expect(answerKey?.schema==='pal-causal-postrun-host-truth-v1'&&
   answerKey.studyRef===packet.agentVisibleTask?.studyRef,
   'missing source-bound post-run truth');
  expect(packet.postRunAnswerKeySHA256===sha(answerKey),
   'post-run answer key digest inconsistent with public packet');
 }else{
  expect(packet.postRunAnswerKeySHA256===null,'unscored attempt must not claim an answer key');
 }
 const target=resolve(outPath),keyPath=target+'.answer-key.json';
 let keyCreated=false;
 try{
  if(scored){
   await writeFile(keyPath,JSON.stringify(answerKey,null,2)+'\n',
    {flag:'wx',mode:0o600});
   keyCreated=true;
  }
  await writeFile(target,JSON.stringify(packet,null,2)+'\n',
   {flag:'wx',mode:0o600});
 }catch(e){
  // Only remove the key if this invocation just created it.
  // Never replace or remove a preexisting packet or key.
  if(keyCreated)await unlink(keyPath).catch(()=>{});
  throw e;
 }
 return Object.freeze({publicPath:target,answerKeyPath:scored?keyPath:null,
  cryptographicallySigned:false,atomicTwoFileTransaction:false});
}

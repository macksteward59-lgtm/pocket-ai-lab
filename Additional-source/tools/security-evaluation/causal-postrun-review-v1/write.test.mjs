import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,lstat,stat,symlink,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeReviewPair} from './write.mjs';

const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const key=Object.freeze({schema:'pal-causal-postrun-host-truth-v1',studyRef:'study-1',caseMapping:[]});
const good=()=>({schema:'pal-pinned-causal-local-model-attempt-v1',
 oneCallStatus:'scored',agentVisibleTask:{studyRef:'study-1'},
 postRunAnswerKeySHA256:digest(key)});
async function inTemp(fn){
 const dir=await mkdtemp(join(tmpdir(),'pal-causal-review-'));
 try{return await fn(join(dir,'trial.json'),dir);}
 finally{await rm(dir,{recursive:true,force:true});}
}

test('paired output is written as two separate mode-0600 JSON files with exact digest',()=>inTemp(async p=>{
 const result=await writeReviewPair({outPath:p,packet:good(),answerKey:key});
 assert.equal(result.cryptographicallySigned,false);
 assert.equal(result.atomicTwoFileTransaction,false);
 const a=JSON.parse(await readFile(p,'utf8')),b=JSON.parse(await readFile(p+'.answer-key.json','utf8'));
 assert.deepEqual(a,good());assert.deepEqual(b,key);
 assert.equal(a.postRunAnswerKeySHA256,digest(b));
 if(process.platform!=='win32'){
  assert.equal((await stat(p)).mode&0o777,0o600);
  assert.equal((await stat(p+'.answer-key.json')).mode&0o777,0o600);
 }
}));
test('failed or incomplete model outcome preserves failure packet without disclosing a key',()=>inTemp(async p=>{
 const trial={schema:'pal-pinned-causal-local-model-attempt-v1',
  oneCallStatus:'failed',postRunAnswerKeySHA256:null};
 const saved=await writeReviewPair({outPath:p,packet:trial});
 assert.equal(saved.answerKeyPath,null);
 assert.deepEqual(JSON.parse(await readFile(p,'utf8')),trial);
 assert.deepEqual(await readdir(join(p,'..')),['trial.json']);
}));
test('scored response without private key is rejected before any filesystem mutation',()=>inTemp(async(p,dir)=>{
 await assert.rejects(()=>writeReviewPair({outPath:p,packet:good()}),/requires a separate/);
 assert.deepEqual(await readdir(dir),[]);
}));
test('inconsistent answer key digest is rejected before files are created',()=>inTemp(async(p,dir)=>{
 const trial=good();trial.postRunAnswerKeySHA256='a'.repeat(64);
 await assert.rejects(()=>writeReviewPair({outPath:p,packet:trial,answerKey:key}),/digest inconsistent/);
 assert.deepEqual(await readdir(dir),[]);
}));
test('an unrelated study answer key may not be joined to a model trial',()=>inTemp(async(p,dir)=>{
 const wrong={...key,studyRef:'other'};
 const trial=good();trial.postRunAnswerKeySHA256=digest(wrong);
 await assert.rejects(()=>writeReviewPair({outPath:p,packet:trial,answerKey:wrong}),/source-bound/);
 assert.deepEqual(await readdir(dir),[]);
}));
test('existing public packet is preserved and newly created answer key is cleaned up',()=>inTemp(async p=>{
 await writeFile(p,'existing-non-replaceable');
 await assert.rejects(()=>writeReviewPair({outPath:p,packet:good(),answerKey:key}),/EEXIST/);
 assert.equal(await readFile(p,'utf8'),'existing-non-replaceable');
 assert.deepEqual(await readdir(join(p,'..')),['trial.json']);
}));
test('existing answer key is preserved with no new public packet created',()=>inTemp(async(p,dir)=>{
 await writeFile(p+'.answer-key.json','prior-key');
 await assert.rejects(()=>writeReviewPair({outPath:p,packet:good(),answerKey:key}),/EEXIST/);
 assert.equal(await readFile(p+'.answer-key.json','utf8'),'prior-key');
 assert.deepEqual(await readdir(dir),['trial.json.answer-key.json']);
}));
test('two concurrent writers cannot both replace a post-run study packet',()=>inTemp(async p=>{
 const results=await Promise.allSettled([
  writeReviewPair({outPath:p,packet:good(),answerKey:key}),
  writeReviewPair({outPath:p,packet:good(),answerKey:key})
 ]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(results.filter(x=>x.status==='rejected').length,1);
 assert.equal(JSON.parse(await readFile(p,'utf8')).postRunAnswerKeySHA256,digest(key));
}));
test('symlink output collision cannot replace another file',()=>inTemp(async(p,dir)=>{
 const protectedPath=join(dir,'protected.txt');
 await writeFile(protectedPath,'original');
 await symlink(protectedPath,p);
 await assert.rejects(()=>writeReviewPair({outPath:p,packet:good(),answerKey:key}),/EEXIST/);
 assert.equal(await readFile(protectedPath,'utf8'),'original');
 assert.equal((await lstat(p)).isSymbolicLink(),true);
}));

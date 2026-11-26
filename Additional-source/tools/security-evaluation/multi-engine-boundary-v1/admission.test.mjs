import test from 'node:test';
import assert from 'node:assert/strict';
import {createMultiEngineBoundary,describeEngines,validateEngineRequest} from './admission.mjs';

const cat=describeEngines();
const snapshots=Object.fromEntries(cat.engines.map(x=>[x.id,x.zipSha256]));
function req(engineId,capability,environment='owned-synthetic'){
 return {taskId:'task-test-01',attemptId:'attempt-test-01',
  engineId,capability,assetRef:'asset:owned-test-01',
  environment,engineSnapshotSha256:snapshots[engineId]};
}
function harness(overrides={}){
 const events=[];let executed=0;let stops=0;let reserved=0;
 const ports={
  now:()=>new Date('2026-11-22T16:00:00Z'),
  checkStop:async()=>{stops++;return {halted:false};},
  checkScope:async r=>({...r,status:'in_scope',policyDigest:'a'.repeat(64)}),
  verifyApex:async (r,s)=>({...r,status:'verified',policyDigest:s.policyDigest,
    approvalRef:'approval-01',expiresAt:'2026-11-22T16:30:00Z'}),
  reserveAttempt:async r=>{reserved++;return {status:'reserved',taskId:r.taskId,attemptId:r.attemptId};},
  journal:async e=>{events.push(e);return {stored:true};},
  execute:async()=>{executed++;return {mock:'host-provided-no-network'}},
  ...overrides,
 };
 return {boundary:createMultiEngineBoundary(ports),events,stats:()=>({executed,stops,reserved})};
}

test('catalog contains all three complete, independently pinned sidecars',()=>{
 assert.equal(cat.schema,'pal-external-security-engines-v1');
 assert.equal(cat.mode,'optional-complete-sidecar-engines');
 assert.deepEqual(cat.engines.map(e=>e.id),['artex','stride-gpt','exploitgym']);
 assert.equal(cat.engines.find(e=>e.id==='artex').license,'AGPL-3.0');
 assert.match(cat.engines.find(e=>e.id==='exploitgym').license,/task data/);
 for(const item of cat.engines){
  assert.match(item.zipSha256,/^[a-f0-9]{64}$/);
  assert.match(item.sourceCommit,/^[a-f0-9]{40}$/);
  assert.ok(item.capabilities.length>=4);
 }
 assert.equal(cat.safety.modelOutputCanGrantAuthority,false);
 assert.equal(cat.safety.crossEngineAuthorityTransfer,false);
});
test('accepts scripted ARTEX offensive capability only after host scope and APEX ports',async()=>{
 const h=harness();const x=await h.boundary.dispatch(req('artex','authorized-http-replay'));
 assert.equal(x.status,'host-dispatched');assert.equal(x.engineResultTrusted,false);
 assert.equal(x.apexReceiptIssuedByThisModule,false);
 assert.deepEqual(h.stats(),{executed:1,stops:3,reserved:1});
 assert.deepEqual(h.events.map(x=>x.kind),['admission.checked','attempt.finished']);
});
test('STRIDE full-model analysis can use source-snapshot mode, still host-admitted',async()=>{
 const h=harness();const x=await h.boundary.dispatch(req('stride-gpt','stride-threat-model','source-snapshot'));
 assert.equal(x.engineId,'stride-gpt');assert.equal(x.status,'host-dispatched');
 assert.equal(h.stats().executed,1);
});
test('ExploitGym owned benchmark is a distinct scoped sidecar, not an APEX authority',async()=>{
 const h=harness();const x=await h.boundary.dispatch(req('exploitgym','isolated-trial'));
 assert.equal(x.engineId,'exploitgym');assert.equal(x.apexReceiptIssuedByThisModule,false);
 assert.equal(x.independentValidation,false);
});
test('rejects unknown engine and capability substitution',()=>{
 assert.throws(()=>validateEngineRequest({...req('artex','authorized-http-replay'),engineId:'other'}),/unknown engine/);
 assert.throws(()=>validateEngineRequest(req('artex','benchmark-provision')),/capability not supported/);
 assert.throws(()=>validateEngineRequest(req('exploitgym','authorized-http-replay')),/capability not supported/);
});
test('rejects wrong uploaded ZIP revision and missing source pin',()=>{
 const changed={...req('artex','authorized-tool-execution'),engineSnapshotSha256:'0'.repeat(64)};
 assert.throws(()=>validateEngineRequest(changed),/unverified or changed/);
 const incomplete={...req('artex','asset-enumeration')};delete incomplete.engineSnapshotSha256;
 assert.throws(()=>validateEngineRequest(incomplete),/missing request fields/);
});
test('rejects model text pretending to issue approval',()=>{
 const injected={...req('artex','authorized-browser-testing'),apexApproved:true};
 assert.throws(()=>validateEngineRequest(injected),/invalid fields/);
});
test('rejects wildcard, raw URL, userinfo, shell and traversal in target reference',()=>{
 for(const assetRef of ['*','https://example.org/','asset:../x','asset:*','asset:../outside',
   'asset:owned?key=token','asset:owned;whoami','asset:owned@other']){
  assert.throws(()=>validateEngineRequest({...req('artex','asset-enumeration'),assetRef}),
   /assetRef must be opaque/);
 }
});
test('read-only local snapshot mode does not accept ARTEX or ExploitGym execution',()=>{
 for(const engineId of ['artex','exploitgym']){
  const cap=engineId==='artex'?'authorized-tool-execution':'isolated-trial';
  assert.throws(()=>validateEngineRequest(req(engineId,cap,'source-snapshot')),/only read-only STRIDE/);
 }
});
test('missing required host authority callbacks fails at construction',()=>{
 const ports={checkScope:async()=>({status:'in_scope'})};
 assert.throws(()=>createMultiEngineBoundary(ports),/trusted host ports missing/);
});
test('current emergency stop fails closed without even trying host scope or executor',async()=>{
 let checks=0;const h=harness({
  checkStop:async()=>({halted:true}),
  checkScope:async()=>{checks++;return {};},
 });
 await assert.rejects(()=>h.boundary.dispatch(req('artex','asset-enumeration')),/stop is active/);
 assert.equal(checks,0);assert.equal(h.stats().executed,0);
});
test('missing scope, wrong asset, or mismatched digest blocks host execution',async()=>{
 for(const bad of [
  ()=>({status:'unverified'}),
  r=>({...r,status:'in_scope',assetRef:'asset:other',policyDigest:'a'.repeat(64)}),
  r=>({...r,status:'in_scope',policyDigest:'bad'})]){
  const h=harness({checkScope:async r=>bad(r)});
  await assert.rejects(()=>h.boundary.dispatch(req('artex','asset-enumeration')),/scope unavailable/);
  assert.equal(h.stats().executed,0);
 }
});
test('model-supplied permission boolean cannot replace verified APEX callback',async()=>{
 const h=harness({verifyApex:async()=>({approved:true,source:'model'})});
 await assert.rejects(()=>h.boundary.dispatch(req('artex','authorized-tool-execution')),/trusted APEX approval unavailable/);
 assert.equal(h.stats().executed,0);
});
test('approval must match exact operation/target/source and current expiry',async()=>{
 const x=req('artex','authorized-browser-testing');
 const h=harness({verifyApex:async (r,s)=>({...r,status:'verified',
   capability:'authorized-http-replay',policyDigest:s.policyDigest,
   approvalRef:'approval-02',expiresAt:'2030-01-01T00:00:00Z'})});
 await assert.rejects(()=>h.boundary.dispatch(x),/not action-bound/);
 assert.equal(h.stats().executed,0);
 const expired=harness({verifyApex:async(r,s)=>({...r,status:'verified',
   policyDigest:s.policyDigest,approvalRef:'approval-02',expiresAt:'2026-11-22T15:59:59Z'})});
 await assert.rejects(()=>expired.boundary.dispatch(x),/expired/);
 assert.equal(expired.stats().executed,0);
});
test('stop activated between host approval and dispatch blocks work',async()=>{
 let checks=0;const h=harness({checkStop:async()=>({halted:++checks===2})});
 await assert.rejects(()=>h.boundary.dispatch(req('artex','authorized-http-replay')),/stop changed before dispatch/);
 assert.equal(h.stats().executed,0);assert.equal(h.stats().reserved,0);
});
test('audit persistence failure cannot be ignored',async()=>{
 const h=harness({journal:async()=>({stored:false})});
 await assert.rejects(()=>h.boundary.dispatch(req('artex','asset-enumeration')),/audit persistence unavailable/);
 assert.equal(h.stats().executed,0);assert.equal(h.stats().reserved,0);
});
test('attempt reservation collision blocks execution without replay',async()=>{
 const h=harness({reserveAttempt:async()=>({status:'duplicate'})});
 await assert.rejects(()=>h.boundary.dispatch(req('exploitgym','benchmark-provision')),/attempt duplicate/);
 assert.equal(h.stats().executed,0);
});
test('late emergency stop after reservation blocks host execution',async()=>{
 let count=0;const h=harness({checkStop:async()=>({halted:++count===3})});
 await assert.rejects(()=>h.boundary.dispatch(req('artex','authorized-browser-testing')),/stop changed after reservation/);
 assert.equal(h.stats().executed,0);
});
test('host engine failure is preserved as unknown and not silently retried',async()=>{
 let calls=0;const h=harness({execute:async()=>{calls++;throw Error('ambiguous host side effect');}});
 const x=await h.boundary.dispatch(req('artex','authorized-http-replay'));
 assert.equal(x.status,'unknown-reconciliation-required');
 assert.equal(calls,1);assert.equal(x.engineResultTrusted,false);
 assert.deepEqual(h.events.map(e=>e.kind),['admission.checked','attempt.uncertain']);
});
test('failed completion-journal write cannot promote completed action',async()=>{
 let calls=0;const h=harness({
  execute:async()=>{calls++;return {response:'not trusted'};},
  journal:async e=>e.kind==='attempt.finished'?{stored:false}:{stored:true}
 });
 const x=await h.boundary.dispatch(req('stride-gpt','sarif-report','source-snapshot'));
 assert.equal(x.status,'unknown-reconciliation-required');assert.equal(calls,1);
});
test('if uncertain attempt cannot be journaled, refuse normal result',async()=>{
 const h=harness({execute:async()=>{throw Error('ambiguous');},
  journal:async e=>e.kind==='admission.checked'?{stored:true}:{stored:false}});
 await assert.rejects(()=>h.boundary.dispatch(req('artex','authorized-tool-execution')),
  /uncertain execution and audit failure/);
});
test('result records never inherit engine self-described authorization',async()=>{
 const h=harness({execute:async()=>({apexAuthorized:true,deviceAttested:true,granted:true})});
 const x=await h.boundary.dispatch(req('exploitgym','trajectory-scoring'));
 assert.equal(x.engineResultTrusted,false);
 assert.equal(x.apexReceiptIssuedByThisModule,false);assert.equal(x.deviceAttested,false);
 assert.equal('granted' in x,false);
});

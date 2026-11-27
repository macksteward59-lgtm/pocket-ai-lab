/**
 * Standalone, host-injected admission contract for complete ARTEX,
 * STRIDE-GPT and ExploitGym sidecars.
 *
 * This module does not sign or verify APEX receipts itself, run a tool,
 * contact a target or implement an agent. The trusted host MUST inject
 * actual scope, APEX, stop, journal, replay-guard and executor ports.
 * Tests use bounded doubles only.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const manifest=JSON.parse(readFileSync(new URL('./engines.json',import.meta.url),'utf8'));
const engines=new Map(manifest.engines.map(e=>[e.id,e]));
const strictKeys=['taskId','attemptId','engineId','capability','assetRef','environment','engineSnapshotSha256'];
const refRe=/^[a-z][a-z0-9-]{2,95}$/;
const assetRe=/^asset:[a-z0-9][a-z0-9._:-]{2,127}$/;
const hexRe=/^[0-9a-f]{64}$/;
const environments=new Set(['owned-synthetic','source-snapshot','approved-target']);
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const present=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;

function requireTruthy(ok,message){if(!ok)throw Error('multi-engine admission: '+message);}
function exactObject(x,keys){
  requireTruthy(present(x)&&Object.keys(x).every(k=>keys.includes(k)),'invalid fields');
}
function exactBinding(record,req){
 return record?.taskId===req.taskId && record?.attemptId===req.attemptId &&
   record?.engineId===req.engineId && record?.capability===req.capability &&
   record?.assetRef===req.assetRef && record?.environment===req.environment &&
   record?.engineSnapshotSha256===req.engineSnapshotSha256;
}
export function describeEngines(){
 return structuredClone(manifest);
}
export function validateEngineRequest(request){
 exactObject(request,strictKeys);
 requireTruthy(Object.keys(request).length===strictKeys.length,'missing request fields');
 requireTruthy(refRe.test(request.taskId)&&refRe.test(request.attemptId),'invalid task/attempt identity');
 requireTruthy(engines.has(request.engineId),'unknown engine');
 const info=engines.get(request.engineId);
 requireTruthy(info.capabilities.includes(request.capability),'capability not supported by selected engine');
 requireTruthy(assetRe.test(request.assetRef),'assetRef must be opaque, exact and not a URL/wildcard');
 requireTruthy(environments.has(request.environment),'unsupported environment');
 requireTruthy(hexRe.test(request.engineSnapshotSha256)&&
   request.engineSnapshotSha256===info.zipSha256,'unverified or changed engine snapshot pin');
 if(request.environment==='source-snapshot'){
  requireTruthy(request.engineId==='stride-gpt' &&
    ['stride-threat-model','attack-tree','dataflow-analysis','source-evidence-check','sarif-report'].includes(request.capability),
    'only read-only STRIDE analysis is eligible for source-snapshot mode');
 }
 return Object.freeze({...request});
}
/**
 * Trusted host controls *all* returned authority and the actual executor.
 * A positive model result, engine self-approval, or scope string is not sufficient.
 */
export function createMultiEngineBoundary(ports){
 const names=['checkStop','checkScope','verifyApex','reserveAttempt','journal','execute'];
 requireTruthy(present(ports)&&names.every(k=>typeof ports[k]==='function'),'trusted host ports missing');
 requireTruthy(ports.now===undefined||typeof ports.now==='function','invalid clock');
 const now=ports.now??(()=>new Date());
 async function journal(event){
  const ack=await ports.journal(Object.freeze({...event}));
  requireTruthy(ack?.stored===true,'audit persistence unavailable');
 }
 return Object.freeze({
  async dispatch(candidate){
   const req=validateEngineRequest(candidate);
   // An internal preflight does not independently authorize an external target.
   requireTruthy((await ports.checkStop(req))?.halted===false,'emergency stop is active/unavailable');
   const scope=await ports.checkScope(req);
   requireTruthy(scope?.status==='in_scope'&&exactBinding(scope,req)&&
     hexRe.test(scope.policyDigest),'scope unavailable, stale or not exact');
   const approval=await ports.verifyApex(req,scope);
   requireTruthy(approval?.status==='verified'&&exactBinding(approval,req)&&
     approval.policyDigest===scope.policyDigest &&
     typeof approval.approvalRef==='string'&&refRe.test(approval.approvalRef) &&
     typeof approval.expiresAt==='string' &&
     Number.isFinite(Date.parse(approval.expiresAt)) &&
     Date.parse(approval.expiresAt)>now().getTime(),
     'trusted APEX approval unavailable, expired, or not action-bound');
   requireTruthy((await ports.checkStop(req))?.halted===false,'stop changed before dispatch');
   const event={taskId:req.taskId,attemptId:req.attemptId,engineId:req.engineId,
     capability:req.capability,assetRef:req.assetRef,environment:req.environment,
     sourceDigest:req.engineSnapshotSha256,scopeDigest:scope.policyDigest,
     approvalRef:approval.approvalRef};
   await journal({kind:'admission.checked',...event});
   // Host reserve must be durable/atomic; no automatic retry on uncertain status.
   const reservation=await ports.reserveAttempt(req,approval);
   requireTruthy(reservation?.status==='reserved' &&
     reservation.taskId===req.taskId&&reservation.attemptId===req.attemptId,
     'attempt duplicate, stale or reservation unavailable');
   // Recheck after reservation, so late stops cannot be silently ignored.
   requireTruthy((await ports.checkStop(req))?.halted===false,'stop changed after reservation');
   try{
    const data=await ports.execute(req,approval); // result is never trusted as authority
    const resultDigest=digest({data});
    await journal({kind:'attempt.finished',...event,resultDigest});
    return Object.freeze({status:'host-dispatched',taskId:req.taskId,
      attemptId:req.attemptId,engineId:req.engineId,
      capability:req.capability,resultDigest,engineResultTrusted:false,
      apexReceiptIssuedByThisModule:false,deviceAttested:false,
      independentValidation:false});
   }catch(error){
    // Possible external side effects make any failure uncertain; never retry.
    try{await journal({kind:'attempt.uncertain',...event,reason:'host-execution-or-journal-error'});}
    catch{throw Error('multi-engine admission: uncertain execution and audit failure; operator reconciliation required');}
    return Object.freeze({status:'unknown-reconciliation-required',
      taskId:req.taskId,attemptId:req.attemptId,engineId:req.engineId,
      capability:req.capability,engineResultTrusted:false,
      apexReceiptIssuedByThisModule:false,deviceAttested:false,
      independentValidation:false});
   }
  }
 });
}

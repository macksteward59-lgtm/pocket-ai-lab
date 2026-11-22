/** Owned loopback-only miniature approval workflow. Synthetic identity headers
 * are NOT authentication; never use this intentionally flawed server in production. */
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';

const ID = /^[a-z0-9-]{3,72}$/;
export const VARIANTS = Object.freeze(['patched','missing-owner-check','missing-separation-check']);
const ACTIONS = Object.freeze(['proper-approval','other-tenant-approval','self-approval','auditor-read','auditor-write','stale-replay']);
export const CASE_KINDS = ACTIONS;

export function newCaseDefinition() {
  const claimId = 'claim-' + randomBytes(12).toString('hex');
  const tenantId = 'tenant-' + randomBytes(6).toString('hex');
  const otherTenant = 'tenant-' + randomBytes(6).toString('hex');
  return Object.freeze({claimId,tenantId,otherTenant,creator:'maker',ownerToken:'owner-' + randomBytes(6).toString('hex')});
}
function safeText(s) {return typeof s==='string' && ID.test(s);}
function validDefinition(d) {return d && [d.claimId,d.tenantId,d.otherTenant,d.ownerToken].every(safeText) && d.tenantId!==d.otherTenant;}
function json(res,status,body) {res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));}

export async function createOwnedService({definition,variant,taskId}) {
 if(!VARIANTS.includes(variant)||!validDefinition(definition)||!safeText(taskId))throw Error('invalid owned-only service input');
 const roles={maker:{tenant:definition.tenantId,reviewer:true},reviewer:{tenant:definition.tenantId,reviewer:true},outsider:{tenant:definition.otherTenant,reviewer:true},auditor:{tenant:'audit',reviewer:false}};
 let state={id:definition.claimId,tenantId:definition.tenantId,status:'pending',version:1,creator:definition.creator};
 const records=[];
 const server=createServer((req,res)=>{
  const path=req.url||'';const actor=req.headers['x-local-actor'];const user=roles[actor];
  if(!user||req.headers['x-local-task']!==taskId||req.headers['x-local-kind']!=='owned-approval-v1')return json(res,403,{error:'fixture_admission_denied'});
  if(req.headers['content-length']&&req.headers['content-length']!=='0'||req.headers['transfer-encoding'])return json(res,413,{error:'body_rejected'});
  if(!path.endsWith('/'+definition.claimId)&&!path.endsWith('/'+definition.claimId+'/approve'))return json(res,404,{error:'unknown_route'});
  let status, body, operation;
  if(path==='/audit/'+definition.claimId && req.method==='GET') {
   operation='audit-read';status=actor==='auditor'?200:403;body=status===200?{id:state.id,tenantId:state.tenantId,status:state.status,version:state.version}:{error:'audit_role_required'};
  }else if(path==='/claims/'+definition.claimId+'/approve'&&req.method==='POST') {
   operation='approve';
   if(!user.reviewer){status=403;body={error:'reviewer_required'};}
   else if(user.tenant!==definition.tenantId&&variant!=='missing-owner-check'){status=403;body={error:'tenant_mismatch'};}
   else if(actor===definition.creator&&variant!=='missing-separation-check'){status=403;body={error:'maker_cannot_approve'};}
   else if(req.headers['if-match']!==`"${state.version}"`||state.status!=='pending') {status=409;body={error:'stale_version_or_state'};}
   else {state={...state,status:'approved',version:state.version+1};status=200;body={id:state.id,tenantId:state.tenantId,status:state.status,version:state.version};}
  }else {return json(res,404,{error:'unknown_route_or_method'});}
  records.push(Object.freeze({actor,operation,resourceId:definition.claimId,httpStatus:status,response:structuredClone(body),after:structuredClone(state)}));
  return json(res,status,body);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
 const addr=server.address();if(!addr||typeof addr==='string'||addr.address!=='127.0.0.1'){server.close();throw Error('not bound to loopback');}
 let closed=false;
 return Object.freeze({origin:`http://127.0.0.1:${addr.port}`,snapshot:()=>Object.freeze({...state}),events:()=>records.map(x=>structuredClone(x)),async close(){if(closed)return;closed=true;await new Promise((r,j)=>server.close(e=>e?j(e):r()));}});
}

export async function executeCase({definition,variant,kind}) {
 if(!CASE_KINDS.includes(kind))throw Error('invalid case');
 const taskId='task-'+randomBytes(8).toString('hex');
 const svc=await createOwnedService({definition,variant,taskId});
 const inputs={
   'proper-approval':[['reviewer','approve']],
   'other-tenant-approval':[['outsider','approve']],
   'self-approval':[['maker','approve']],
   'auditor-read':[['auditor','audit-read']],
   'auditor-write':[['auditor','approve']],
   'stale-replay':[['reviewer','approve'],['reviewer','approve']],
 }[kind];
 const seen=[];
 try{
  for(const [actor,operation] of inputs){
   const path=operation==='audit-read'?`/audit/${definition.claimId}`:`/claims/${definition.claimId}/approve`;
   const url=svc.origin+path;const response=await fetch(url,{method:operation==='audit-read'?'GET':'POST',redirect:'manual',cache:'no-store',headers:{'x-local-kind':'owned-approval-v1','x-local-task':taskId,'x-local-actor':actor,'if-match':'"1"'},signal:AbortSignal.timeout(2200)});
   if(response.url!==url||response.status>=300&&response.status<400)throw Error('redirect/origin not allowed');
   const body=await response.text();if(Buffer.byteLength(body)>1024)throw Error('oversize owned response');
   seen.push(Object.freeze({actor,operation,resourceId:definition.claimId,httpStatus:response.status,response:JSON.parse(body)}));
  }
  return Object.freeze({kind,taskId,observations:seen,serverEvents:svc.events(),after:svc.snapshot(),requestCount:seen.length,externalTargets:0});
 }finally{await svc.close();}
}

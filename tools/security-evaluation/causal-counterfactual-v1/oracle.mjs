/** Independent, host-only differential policy oracle for the owned HTTP fixture.
 * Not a production authority, cryptographic signer, or independent human review. */
import {CASE_KINDS} from './fixture.mjs';

const BASE={
 'proper-approval':[200], 'other-tenant-approval':[403], 'self-approval':[403],
 'auditor-read':[200], 'auditor-write':[403], 'stale-replay':[200,409],
};
const CANDIDATE={
 'missing-owner-check':'other-tenant-approval',
 'missing-separation-check':'self-approval',
};

function equal(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function status(r){return r.observations.map(x=>x.httpStatus);}
function goodState(kind,result,expected){
 const after=result.after;
 if(after?.status !== (expected[0]===200&&kind!=='auditor-read'?'approved':'pending'))return false;
 if(after?.version !== (after.status==='approved'?2:1))return false;
 if(result.requestCount!==expected.length||result.serverEvents.length!==expected.length||result.externalTargets!==0)return false;
 for(let i=0;i<result.observations.length;i++){
  const a=result.observations[i],b=result.serverEvents[i];
  if(a.actor!==b.actor||a.operation!==b.operation||a.resourceId!==b.resourceId||a.httpStatus!==b.httpStatus||!equal(a.response,b.response))return false;
  if(!['approve','audit-read'].includes(a.operation)||!a.resourceId||typeof a.httpStatus!=='number')return false;
 }
 return true;
}

export function validateCounterfactualPair({variant,results}){
 const target=CANDIDATE[variant];if(!target||!results||Object.keys(results).length!==CASE_KINDS.length)return {ok:false,reason:'unsupported variant/coverage'};
 let differences=0;
 for(const kind of CASE_KINDS){
  const pair=results[kind];if(!pair?.candidate||!pair.patched||pair.candidate.kind!==kind||pair.patched.kind!==kind)return {ok:false,reason:'missing pair: '+kind};
  const fixed=BASE[kind],candidate=kind===target?[200]:fixed;
  if(!equal(status(pair.patched),fixed)||!equal(status(pair.candidate),candidate))return {ok:false,reason:'unexpected HTTP status: '+kind};
  if(!goodState(kind,pair.patched,fixed)||!goodState(kind,pair.candidate,candidate))return {ok:false,reason:'unexpected state/trace: '+kind};
  if(!equal(status(pair.candidate),status(pair.patched))){differences++;if(kind!==target||!equal(status(pair.candidate),[200])||!equal(status(pair.patched),[403]))return{ok:false,reason:'wrong counterfactual location'};}
 }
 return Object.freeze({ok:differences===1,differences,sourceMutationFamily:variant,causalCaseKind:target,method:'exact-host-source-mutation-with-patched-loopback-control',independentReviewerAttested:false,rootCauseIdentityEstablishment:'synthetic-source-toggle-only'});
}

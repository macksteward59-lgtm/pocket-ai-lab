/** Separate deterministic oracle over known synthetic fixture identities. */

const OWNER = Object.freeze({'invoice-alpha': 'alpha', 'invoice-beta': 'beta'});
const TENANT = Object.freeze({alice: 'alpha', bob: 'beta'});

export function expectedDecision({actor, tenant, invoiceId, action, before}) {
  if (!Object.hasOwn(TENANT, actor) || !Object.hasOwn(OWNER, invoiceId) ||
      !['alpha', 'beta'].includes(tenant) || !['read', 'approve'].includes(action)) {
    return 'deny';
  }
  if (TENANT[actor] !== tenant || OWNER[invoiceId] !== tenant) return 'deny';
  if (action === 'approve' && before?.status !== 'pending') return 'conflict';
  return 'allow';
}

/** The auditor is explicitly allowed to view synthetic invoices across tenants,
 * but is never permitted to approve them. This is a separate source-of-truth
 * policy for the negative false-positive control, not a production policy. */
export function expectedAuditDecision({actor, action, invoiceId}) {
  if (!Object.hasOwn(OWNER, invoiceId)) return 'deny';
  return actor === 'auditor' && action === 'audit-read' ? 'allow' : 'deny';
}

export function assessAuditSequence(sequence) {
  const {auditorAlpha, auditorBeta, aliceAuditDenied, auditorMutationDenied, betaAfter} = sequence ?? {};
  const events=[auditorAlpha, auditorBeta, aliceAuditDenied, auditorMutationDenied, betaAfter];
  if (events.some(event=>!event || !Number.isInteger(event.status) || typeof event.taskId !== 'string')) {
    return {status:'inconclusive', reason:'incomplete audit-control HTTP observations'};
  }
  if (new Set(events.map(x=>x.taskId)).size!==1) {
    return {status:'inconclusive',reason:'audit-control task identity mismatch'};
  }
  const plan=[
    ['auditor',null,'invoice-alpha','audit-read'],
    ['auditor',null,'invoice-beta','audit-read'],
    ['alice',null,'invoice-beta','audit-read'],
    ['auditor',null,'invoice-beta','audit-approve'],
    ['bob','beta','invoice-beta','read'],
  ];
  for (let i=0;i<plan.length;i++) {
    const [actor,tenant,invoiceId,action]=plan[i],event=events[i];
    if (event.actor!==actor || event.tenant!==tenant || event.invoiceId!==invoiceId || event.action!==action) {
      return {status:'inconclusive',reason:'audit-control sequence differs from frozen plan'};
    }
  }
  if (expectedAuditDecision(auditorAlpha)!=='allow' || expectedAuditDecision(auditorBeta)!=='allow' ||
      expectedAuditDecision(aliceAuditDenied)!=='deny' || expectedAuditDecision(auditorMutationDenied)!=='deny') {
    return {status:'inconclusive',reason:'invalid independent privilege policy'};
  }
  if (auditorAlpha.status!==200 || auditorAlpha.body?.id!=='invoice-alpha' ||
      auditorAlpha.body.ownerTenant!=='alpha' || auditorAlpha.body.status!=='pending' || auditorAlpha.body.version!==1 ||
      auditorBeta.status!==200 || auditorBeta.body?.id!=='invoice-beta' || auditorBeta.body.ownerTenant!=='beta' ||
      auditorBeta.body.status!=='pending' || auditorBeta.body.version!==1 ||
      aliceAuditDenied.status!==403 || aliceAuditDenied.body?.error!=='audit_role_required' ||
      auditorMutationDenied.status!==403 || auditorMutationDenied.body?.error!=='audit_read_only' ||
      betaAfter.status!==200 || betaAfter.body?.ownerTenant!=='beta' || betaAfter.body.id!=='invoice-beta' ||
      betaAfter.body.status!=='pending' || betaAfter.body.version!==1) {
    return {status:'inconclusive',reason:'audit-control positive/negative/state checks failed'};
  }
  return Object.freeze({status:'legitimate-admin-control-passed',confirmedFinding:false,
    intentionalPrivilege:'auditor-read-only',realTargetProven:false,requiresIndependentReview:true});
}

export function assessRecordedSequence(sequence) {
  const {ownRead, betaBefore, crossRead, crossApproval, betaAfter, ownApproval, ownReplay} = sequence ?? {};
  const events = [ownRead, betaBefore, crossRead, crossApproval, betaAfter, ownApproval, ownReplay];
  if (events.some(x => !x || !Number.isInteger(x.status) || typeof x.taskId !== 'string')) {
    return {status: 'inconclusive', reason: 'incomplete HTTP observations'};
  }
  if (new Set(events.map(x => x.taskId)).size !== 1) return {status: 'inconclusive', reason: 'task identity mismatch'};
  const expectedSteps = [
    ['alice', 'alpha', 'invoice-alpha', 'read'],
    ['bob', 'beta', 'invoice-beta', 'read'],
    ['alice', 'alpha', 'invoice-beta', 'read'],
    ['alice', 'alpha', 'invoice-beta', 'approve'],
    ['bob', 'beta', 'invoice-beta', 'read'],
    ['alice', 'alpha', 'invoice-alpha', 'approve'],
    ['alice', 'alpha', 'invoice-alpha', 'approve'],
  ];
  for (const [index, [actor, tenant, invoiceId, action]] of expectedSteps.entries()) {
    const record = events[index];
    if (record.actor !== actor || record.tenant !== tenant ||
        record.invoiceId !== invoiceId || record.action !== action) {
      return {status: 'inconclusive', reason: 'fixture request sequence does not match frozen plan'};
    }
  }
  if (ownRead.status !== 200 || ownRead.body?.ownerTenant !== 'alpha' ||
      ownRead.body.id !== 'invoice-alpha' || ownRead.body.status !== 'pending' ||
      ownRead.body.version !== 1 || betaBefore.status !== 200 || betaBefore.body.id !== 'invoice-beta' ||
      betaBefore.body.ownerTenant !== 'beta' || betaBefore.body.status !== 'pending' ||
      betaBefore.body.version !== 1 || ownApproval.status !== 200 ||
      ownApproval.body?.id !== 'invoice-alpha' || ownApproval.body.ownerTenant !== 'alpha' ||
      ownApproval.body.status !== 'approved' || ownApproval.body.version !== 2 ||
      ownReplay.status !== 409 ||
      betaAfter.status !== 200 || betaAfter.body.ownerTenant !== 'beta' || betaAfter.body.id !== 'invoice-beta') {
    return {status: 'inconclusive', reason: 'failed positive or state controls'};
  }
  // Fixed independent authorization rule: alpha cannot read/mutate beta's invoice.
  const crossReadExpected = expectedDecision({actor: crossRead.actor, tenant: crossRead.tenant, invoiceId: crossRead.invoiceId, action: 'read'});
  const crossApproveExpected = expectedDecision({actor: crossApproval.actor, tenant: crossApproval.tenant, invoiceId: crossApproval.invoiceId, action: 'approve', before: betaBefore.body});
  if (crossReadExpected !== 'deny' || crossApproveExpected !== 'deny') {
    return {status: 'inconclusive', reason: 'test did not exercise an expected-deny cross-tenant action'};
  }
  if (crossRead.status === 404 && crossApproval.status === 404 &&
      betaAfter.body.status === 'pending' && betaAfter.body.version === 1) {
    return {status: 'negative-control-passed', confirmedFinding: false, realTargetProven: false};
  }
  if (crossRead.status === 200 && crossApproval.status === 200 &&
      crossRead.body.ownerTenant === 'beta' && crossRead.body.id === 'invoice-beta' &&
      crossApproval.body.ownerTenant === 'beta' && crossApproval.body.id === 'invoice-beta' &&
      crossApproval.body.status === 'approved' && crossApproval.body.version === 2 &&
      betaAfter.body.status === 'approved' && betaAfter.body.version === 2) {
    return {
      status: 'synthetic-flaw-reproduced', confirmedFinding: true,
      explanation: 'synthetic cross-tenant read and unauthorized approval observed through the loopback HTTP server',
      realTargetProven: false, liveAuthorizationProven: false,
      requiresIndependentReview: true,
    };
  }
  return {status: 'inconclusive', reason: 'observations do not satisfy either complete control'};
}

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

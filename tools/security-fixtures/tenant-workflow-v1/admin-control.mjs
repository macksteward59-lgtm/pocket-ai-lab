/**
 * Independent legitimate-privilege negative control for the local tenant lab.
 * This is a separate, frozen scenario from the original seven-request defect
 * test. Authoritative evaluation comes from oracle.mjs, not an LLM or pixels.
 */
import { createOwnedFixture } from './fixture.mjs';
import { createOwnedClient } from './client.mjs';
import { assessAuditSequence } from './oracle.mjs';
import { journalFor, verifyJournal } from './evidence.mjs';
import { fileURLToPath } from 'node:url';

export async function runAuditControl(mode, {requestLimit = 5} = {}) {
  const taskId = `owned-audit-${mode}`;
  const fixture = await createOwnedFixture({mode, taskId});
  try {
    const client = createOwnedClient({origin: fixture.origin, taskId, requestLimit});
    const sequence = {
      auditorAlpha: await client.invoke({actor: 'auditor', invoiceId: 'invoice-alpha', action: 'audit-read'}),
      auditorBeta: await client.invoke({actor: 'auditor', invoiceId: 'invoice-beta', action: 'audit-read'}),
      aliceAuditDenied: await client.invoke({actor: 'alice', invoiceId: 'invoice-beta', action: 'audit-read'}),
      auditorMutationDenied: await client.invoke({actor: 'auditor', invoiceId: 'invoice-beta', action: 'audit-approve', version: 1}),
      betaAfter: await client.invoke({actor: 'bob', tenant: 'beta', invoiceId: 'invoice-beta', action: 'read'}),
    };
    const summary = Object.freeze(assessAuditSequence(sequence));
    const journal = journalFor(taskId, Object.values(sequence));
    if (!verifyJournal(journal)) throw new Error('audit-control evidence chain failed');
    return Object.freeze({
      schema: 'pocket-tenant-audit-control-v1', mode, taskId,
      executionKind: 'real-http-on-owned-loopback-fixture',
      authority: 'synthetic-fixture-only',
      fixtureOnly: true, realVulnerabilityProven: false,
      modelRuntime: 'none', screenshotCapture: 'none',
      apexAuthorization: 'not-integrated', eastDurability: 'not-integrated', exploitGym: 'not-integrated',
      requests: client.consumed, summary, finalState: fixture.snapshot(),
      journal, journalIntegrityVerified: true, actualExternalTargets: 0,
    });
  } finally {
    await fixture.close();
  }
}

export async function runAuditPair() {
  const enforced = await runAuditControl('enforced');
  const flawed = await runAuditControl('intentionally-flawed');
  if (enforced.summary.status !== 'legitimate-admin-control-passed' ||
      flawed.summary.status !== 'legitimate-admin-control-passed') {
    throw new Error('intended privileged audit must be a negative control in both variants');
  }
  return Object.freeze({enforced, flawed});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const {enforced, flawed} = await runAuditPair();
    console.log(JSON.stringify({
      schema: 'pocket-audit-control-demo-v1',
      enforced: {status: enforced.summary.status, requests: enforced.requests, journalTail: enforced.journal.at(-1).eventHash},
      intentionallyFlawed: {status: flawed.summary.status, requests: flawed.requests, journalTail: flawed.journal.at(-1).eventHash},
      externalTargets: 0, realProductIntegration: false,
    }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

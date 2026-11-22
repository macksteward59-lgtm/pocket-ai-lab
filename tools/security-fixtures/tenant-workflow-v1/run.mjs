import { createOwnedFixture } from './fixture.mjs';
import { createOwnedClient } from './client.mjs';
import { assessRecordedSequence } from './oracle.mjs';
import { journalFor, verifyJournal } from './evidence.mjs';
import { fileURLToPath } from 'node:url';

export async function runSyntheticScenario(mode, {requestLimit = 7} = {}) {
  const taskId = `owned-fixture-${mode}`;
  const fixture = await createOwnedFixture({mode, taskId});
  try {
    const client = createOwnedClient({origin: fixture.origin, taskId, requestLimit});
    const sequence = {
      ownRead: await client.invoke({actor: 'alice', tenant: 'alpha', invoiceId: 'invoice-alpha', action: 'read'}),
      betaBefore: await client.invoke({actor: 'bob', tenant: 'beta', invoiceId: 'invoice-beta', action: 'read'}),
      crossRead: await client.invoke({actor: 'alice', tenant: 'alpha', invoiceId: 'invoice-beta', action: 'read'}),
      crossApproval: await client.invoke({actor: 'alice', tenant: 'alpha', invoiceId: 'invoice-beta', action: 'approve', version: 1}),
      betaAfter: await client.invoke({actor: 'bob', tenant: 'beta', invoiceId: 'invoice-beta', action: 'read'}),
      ownApproval: await client.invoke({actor: 'alice', tenant: 'alpha', invoiceId: 'invoice-alpha', action: 'approve', version: 1}),
      ownReplay: await client.invoke({actor: 'alice', tenant: 'alpha', invoiceId: 'invoice-alpha', action: 'approve', version: 1}),
    };
    const oracle = Object.freeze(assessRecordedSequence(sequence));
    const journal = journalFor(taskId, Object.values(sequence));
    if (!verifyJournal(journal)) throw new Error('synthetic evidence chain inconsistent');
    return Object.freeze({
      schema: 'pocket-tenant-fixture-report-v1', mode, taskId,
      executionKind: 'real-http-on-owned-loopback-fixture',
      authority: 'synthetic-fixture-only',
      modelRuntime: 'none', screenshotCapture: 'none',
      apexAuthorization: 'not-integrated', eastDurability: 'not-integrated', exploitGym: 'not-integrated',
      requests: client.consumed, summary: oracle,
      finalState: fixture.snapshot(), journal,
      journalIntegrityVerified: true,
      actualExternalTargets: 0,
    });
  } finally {
    await fixture.close();
  }
}

export async function runPair() {
  const enforced = await runSyntheticScenario('enforced');
  const flawed = await runSyntheticScenario('intentionally-flawed');
  if (enforced.summary.status !== 'negative-control-passed' || flawed.summary.status !== 'synthetic-flaw-reproduced') {
    throw new Error('synthetic expected findings did not hold');
  }
  return Object.freeze({enforced, flawed});
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = await runPair();
    console.log(JSON.stringify({
      schema: 'pocket-tenant-fixture-demo-v1',
      enforced: {status: result.enforced.summary.status, requests: result.enforced.requests, journalTail: result.enforced.journal.at(-1).eventHash},
      intentionallyFlawed: {status: result.flawed.summary.status, requests: result.flawed.requests, journalTail: result.flawed.journal.at(-1).eventHash},
      externalTargets: 0, realProductIntegration: false,
    }, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

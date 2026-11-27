import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnedFixture } from './fixture.mjs';
import { createOwnedClient } from './client.mjs';
import { assessAuditSequence, expectedAuditDecision } from './oracle.mjs';
import { runAuditControl, runAuditPair } from './admin-control.mjs';
import { verifyJournal } from './evidence.mjs';

const TASK = 'audit-control-1';

test('legitimate cross-tenant auditor read is not a vulnerability (enforced)', async () => {
  const result = await runAuditControl('enforced');
  assert.equal(result.summary.status, 'legitimate-admin-control-passed');
  assert.equal(result.summary.confirmedFinding, false);
  assert.equal(result.requests, 5);
  assert.equal(result.finalState['invoice-beta'].status, 'pending');
});

test('legitimate cross-tenant auditor read is not a vulnerability (intentionally flawed)', async () => {
  const result = await runAuditControl('intentionally-flawed');
  assert.equal(result.summary.status, 'legitimate-admin-control-passed');
  assert.equal(result.summary.confirmedFinding, false);
  assert.equal(result.finalState['invoice-beta'].version, 1);
});

test('both modes classify the intended audit capability as a negative control', async () => {
  const pair = await runAuditPair();
  assert.equal(pair.enforced.summary.intentionalPrivilege, 'auditor-read-only');
  assert.equal(pair.flawed.summary.intentionalPrivilege, 'auditor-read-only');
  assert.notEqual(pair.enforced.taskId, pair.flawed.taskId);
});

test('independent policy limits audit authority to read only', () => {
  assert.equal(expectedAuditDecision({actor:'auditor', action:'audit-read', invoiceId:'invoice-beta'}), 'allow');
  assert.equal(expectedAuditDecision({actor:'auditor', action:'audit-approve', invoiceId:'invoice-beta'}), 'deny');
  assert.equal(expectedAuditDecision({actor:'alice', action:'audit-read', invoiceId:'invoice-beta'}), 'deny');
  assert.equal(expectedAuditDecision({actor:'bob', action:'audit-read', invoiceId:'invoice-alpha'}), 'deny');
  assert.equal(expectedAuditDecision({actor:'auditor', action:'read', invoiceId:'invoice-alpha'}), 'deny');
  assert.equal(expectedAuditDecision({actor:'auditor', action:'audit-read', invoiceId:'unknown'}), 'deny');
});

test('non-auditor cannot access the audit route in either server mode', async () => {
  for (const mode of ['enforced', 'intentionally-flawed']) {
    const fixture=await createOwnedFixture({mode,taskId:TASK});
    try {
      const client=createOwnedClient({origin:fixture.origin,taskId:TASK});
      const result=await client.invoke({actor:'alice',action:'audit-read',invoiceId:'invoice-beta'});
      assert.equal(result.status,403);
    } finally { await fixture.close(); }
  }
});

test('auditor cannot approve invoice or mutate beta invoice in either mode', async () => {
  for (const mode of ['enforced','intentionally-flawed']) {
    const fx=await createOwnedFixture({mode, taskId:TASK});
    try {
      const client=createOwnedClient({origin:fx.origin,taskId:TASK});
      const result=await client.invoke({actor:'auditor',action:'audit-approve',invoiceId:'invoice-beta',version:1});
      assert.equal(result.status,403);
      assert.equal(result.body.error,'audit_read_only');
      assert.equal(fx.snapshot()['invoice-beta'].status,'pending');
      assert.equal(fx.snapshot()['invoice-beta'].version,1);
    } finally { await fx.close(); }
  }
});

test('auditor cannot enter a tenant-only user route', async () => {
  const fx=await createOwnedFixture({mode:'intentionally-flawed',taskId:TASK});
  try {
    const client=createOwnedClient({origin:fx.origin,taskId:TASK});
    const response=await client.invoke({actor:'auditor',action:'read',tenant:'beta',invoiceId:'invoice-beta'});
    assert.equal(response.status,403);
  } finally {await fx.close();}
});

test('audit endpoint rejects missing, incorrect task and synthetic identity', async () => {
  const fx=await createOwnedFixture({mode:'enforced',taskId:TASK});
  try {
    const path=fx.origin+'/api/audit/invoices/invoice-beta';
    const r1=await fetch(path);
    const r2=await fetch(path,{headers:{'x-fixture-kind':fx.kind,'x-fixture-task':'other','x-fixture-actor':'auditor'}});
    const r3=await fetch(path,{headers:{'x-fixture-kind':fx.kind,'x-fixture-task':TASK,'x-fixture-actor':'alice'}});
    assert.equal(r1.status,403);
    assert.equal(r2.status,403);
    assert.equal(r3.status,403);
  } finally {await fx.close();}
});

test('audit endpoint refuses query tricks, unknown routes and improper methods', async () => {
  const fx=await createOwnedFixture({mode:'enforced',taskId:TASK});
  try {
    const headers={'x-fixture-kind':fx.kind,'x-fixture-task':TASK,'x-fixture-actor':'auditor'};
    const base=fx.origin+'/api/audit/invoices/invoice-beta';
    assert.equal((await fetch(base+'?token=bad',{headers})).status,404);
    assert.equal((await fetch(base+'/approval',{headers})).status,404);
    assert.equal((await fetch(base,{headers,method:'POST'})).status,405);
    assert.equal((await fetch(base+'/approve',{headers,method:'GET'})).status,405);
    assert.equal((await fetch(base+'/approve',{headers,method:'POST'})).status,403);
  } finally {await fx.close();}
});

test('audit client rejects arbitrary URLs and mismatched tenant/method arguments', async () => {
  const fx=await createOwnedFixture({mode:'enforced',taskId:TASK});
  try {
    const client=createOwnedClient({origin:fx.origin,taskId:TASK});
    for (const bad of [
      {actor:'auditor',action:'audit-read',invoiceId:'invoice-beta',tenant:'beta'},
      {actor:'auditor',action:'audit-read',invoiceId:'../../etc'},
      {actor:'auditor',action:'audit-delete',invoiceId:'invoice-beta'},
      {actor:'auditor',action:'audit-approve',invoiceId:'invoice-beta',version:0},
    ]) await assert.rejects(()=>client.invoke(bad), /invalid|version/);
    assert.equal(client.consumed,0);
  } finally {await fx.close();}
});

test('audit-control oracle does not accept a forged high-level success status', async () => {
  const good=await runAuditControl('enforced');
  const records=good.journal.map(e=>JSON.parse(e.payload));
  const names=['auditorAlpha','auditorBeta','aliceAuditDenied','auditorMutationDenied','betaAfter'];
  const sequence=Object.fromEntries(names.map((name,i)=>[name,records[i]]));
  assert.equal(assessAuditSequence(sequence).status,'legitimate-admin-control-passed');
  const forged=structuredClone(sequence);
  forged.auditorMutationDenied.status=200;
  assert.equal(assessAuditSequence(forged).status,'inconclusive');
  const forgedTenant=structuredClone(sequence);
  forgedTenant.betaAfter.body.status='approved';
  assert.equal(assessAuditSequence(forgedTenant).status,'inconclusive');
  const switched=structuredClone(sequence);
  switched.aliceAuditDenied.actor='auditor';
  assert.equal(assessAuditSequence(switched).status,'inconclusive');
});

test('audit evidence journal is internally consistent but not attested', async () => {
  const result=await runAuditControl('enforced');
  assert.equal(verifyJournal(result.journal),true);
  assert.equal(result.apexAuthorization,'not-integrated');
  assert.equal(result.exploitGym,'not-integrated');
  assert.equal(result.eastDurability,'not-integrated');
  assert.equal(result.screenshotCapture,'none');
  assert.equal(result.realVulnerabilityProven,false);
  assert.equal(result.actualExternalTargets,0);
});

test('audit request cap is shared and enforced for concurrent calls', async () => {
  const fx=await createOwnedFixture({mode:'enforced',taskId:TASK});
  try {
    const client=createOwnedClient({origin:fx.origin,taskId:TASK,requestLimit:1});
    const q=()=>client.invoke({actor:'auditor',action:'audit-read',invoiceId:'invoice-beta'});
    const results=await Promise.allSettled([q(),q()]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    assert.equal(client.consumed,1);
  } finally {await fx.close();}
});

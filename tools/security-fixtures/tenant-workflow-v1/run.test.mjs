import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedFixture} from './fixture.mjs';
import {createOwnedClient, validateOwnedOrigin} from './client.mjs';
import {expectedDecision, assessRecordedSequence} from './oracle.mjs';
import {journalFor, verifyJournal} from './evidence.mjs';
import {runPair, runSyntheticScenario} from './run.mjs';

const runId = 'test-tenants-1';

test('enforced workflow denies cross-tenant read and writes while preserving state', async () => {
  const result = await runSyntheticScenario('enforced');
  assert.equal(result.summary.status, 'negative-control-passed');
  assert.equal(result.finalState['invoice-beta'].status, 'pending');
  assert.equal(result.finalState['invoice-alpha'].status, 'approved');
  assert.equal(result.requests, 7);
  assert.equal(result.actualExternalTargets, 0);
});

test('deliberately flawed workflow reproduces cross-tenant read and state mutation', async () => {
  const result = await runSyntheticScenario('intentionally-flawed');
  assert.equal(result.summary.status, 'synthetic-flaw-reproduced');
  assert.equal(result.finalState['invoice-beta'].status, 'approved');
  assert.equal(result.finalState['invoice-beta'].version, 2);
  assert.equal(result.summary.realTargetProven, false);
});

test('positive and negative fixture pair is correctly distinguished by independent oracle', async () => {
  const {enforced, flawed} = await runPair();
  assert.equal(enforced.summary.confirmedFinding, false);
  assert.equal(flawed.summary.confirmedFinding, true);
});

test('expected decision is based on owner identity, not route tenant alone', () => {
  assert.equal(expectedDecision({actor:'alice',tenant:'alpha',invoiceId:'invoice-alpha',action:'read'}), 'allow');
  assert.equal(expectedDecision({actor:'alice',tenant:'alpha',invoiceId:'invoice-beta',action:'read'}), 'deny');
  assert.equal(expectedDecision({actor:'bob',tenant:'beta',invoiceId:'invoice-beta',action:'approve',before:{status:'pending'}}), 'allow');
  assert.equal(expectedDecision({actor:'mallory',tenant:'alpha',invoiceId:'invoice-alpha',action:'read'}), 'deny');
});

test('missing or mutated task ID makes oracle result inconclusive', async () => {
  const fx = await createOwnedFixture({mode:'enforced',taskId:runId});
  try {
    const client = createOwnedClient({origin:fx.origin,taskId:runId});
    const result = await client.invoke({actor:'alice',tenant:'alpha',invoiceId:'invoice-alpha',action:'read'});
    assert.equal(assessRecordedSequence({ownRead:result}).status, 'inconclusive');
  } finally {await fx.close();}
});

test('fixture refuses anything except fixed modes and valid synthetic task IDs', async () => {
  await assert.rejects(() => createOwnedFixture({mode:'production',taskId:runId}), /unknown local fixture/);
  await assert.rejects(() => createOwnedFixture({mode:'enforced',taskId:'not an id'}), /invalid synthetic task/);
});

test('client rejects public hosts, hostname tricks, arbitrary paths and credentials before a request', () => {
  for (const value of ['https://example.com','http://localhost:1234','http://127.0.0.1.evil.test:1234',
    'http://127.0.0.1:1234/private','http://user:pass@127.0.0.1:1234',
    'http://127.0.0.1:1234?key=anything','http://127.0.0.1:1234#x',
    'http://[::1]:1234','http://127.0.0.1:0','file:///etc/passwd']) {
    assert.throws(() => validateOwnedOrigin(value));
  }
  assert.equal(validateOwnedOrigin('http://127.0.0.1:1234'),'http://127.0.0.1:1234');
});

test('client restricts tenant, actor, object and method inputs', async () => {
  const fx = await createOwnedFixture({mode:'enforced',taskId:runId});
  try {
    const c = createOwnedClient({origin:fx.origin,taskId:runId});
    for (const bad of [
      {actor:'alice',tenant:'../../beta',invoiceId:'invoice-beta',action:'read'},
      {actor:'alice',tenant:'alpha',invoiceId:'https://elsewhere',action:'read'},
      {actor:'alice',tenant:'alpha',invoiceId:'invoice-beta',action:'delete'},
      {actor:'bob\r\nx:evil',tenant:'beta',invoiceId:'invoice-beta',action:'read'},
      {actor:'bob',tenant:'beta',invoiceId:'invoice-beta',action:'approve',version:0},
    ]) await assert.rejects(() => c.invoke(bad), /invalid|version/);
    assert.equal(c.consumed,0);
  } finally {await fx.close();}
});

test('client enforces request count even with concurrent invocations', async () => {
  const fx = await createOwnedFixture({mode:'enforced',taskId:runId});
  try {
    const c = createOwnedClient({origin:fx.origin,taskId:runId,requestLimit:1});
    const call = () => c.invoke({actor:'alice',tenant:'alpha',invoiceId:'invoice-alpha',action:'read'});
    const settled = await Promise.allSettled([call(),call()]);
    assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(settled.filter(x=>x.status==='rejected').length,1);
    assert.equal(c.consumed,1);
  } finally {await fx.close();}
});

test('server requires synthetic identity and does not accept arbitrary task identifiers', async () => {
  const fx = await createOwnedFixture({mode:'enforced',taskId:runId});
  try {
    const u = fx.origin+'/api/tenants/alpha/invoices/invoice-alpha';
    const noHeaders = await fetch(u);
    assert.equal(noHeaders.status,403);
    const wrongTask = await fetch(u,{headers:{'x-fixture-kind':fx.kind,'x-fixture-task':'other-id','x-fixture-actor':'alice'}});
    assert.equal(wrongTask.status,403);
    const wrongActor = await fetch(u,{headers:{'x-fixture-kind':fx.kind,'x-fixture-task':runId,'x-fixture-actor':'unknown'}});
    assert.equal(wrongActor.status,403);
  }finally{await fx.close();}
});

test('actor cannot route into another synthetic tenant namespace', async () => {
  const fx = await createOwnedFixture({mode:'intentionally-flawed',taskId:runId});
  try {
    const c = createOwnedClient({origin:fx.origin,taskId:runId});
    const e = await c.invoke({actor:'alice',tenant:'beta',invoiceId:'invoice-beta',action:'read'});
    assert.equal(e.status,404);
  }finally{await fx.close();}
});

test('fixture rejects unrecognized paths, query strings and method mismatches', async () => {
  const fx = await createOwnedFixture({mode:'enforced',taskId:runId});
  try {
    const url=fx.origin+'/api/tenants/alpha/invoices/invoice-alpha';
    const headers={'x-fixture-kind':fx.kind,'x-fixture-task':runId,'x-fixture-actor':'alice'};
    assert.equal((await fetch(url+'?leak=1',{headers})).status,404);
    assert.equal((await fetch(url,{headers,method:'POST'})).status,405);
    assert.equal((await fetch(url+'/approve',{headers,method:'GET'})).status,405);
    assert.equal((await fetch(url,{headers,method:'DELETE'})).status,405);
    assert.equal((await fetch(url,{headers,method:'POST',body:'x'})).status,413);
  }finally{await fx.close();}
});

test('stale mutation versions fail with 409 without changing state', async () => {
  const fx = await createOwnedFixture({mode:'enforced',taskId:runId});
  try {
    const c = createOwnedClient({origin:fx.origin,taskId:runId});
    const v1 = await c.invoke({actor:'alice',tenant:'alpha',invoiceId:'invoice-alpha',action:'approve',version:1});
    const replay = await c.invoke({actor:'alice',tenant:'alpha',invoiceId:'invoice-alpha',action:'approve',version:1});
    assert.equal(v1.status,200);
    assert.equal(replay.status,409);
    assert.equal(fx.snapshot()['invoice-alpha'].version,2);
  }finally{await fx.close();}
});

test('journal verifies each observation and detects tamper, reordering and missing events', async () => {
  const data = await runSyntheticScenario('intentionally-flawed');
  assert.equal(verifyJournal(data.journal),true);
  const altered=structuredClone(data.journal);altered[3].payload=altered[3].payload.replace('"status":200','"status":404');
  assert.equal(verifyJournal(altered),false);
  const swapped=structuredClone(data.journal);[swapped[2],swapped[3]]=[swapped[3],swapped[2]];
  assert.equal(verifyJournal(swapped),false);
  assert.equal(verifyJournal(data.journal.slice(1)),false);
});

test('journal forbids mixed task identities',()=>{
  assert.throws(()=>journalFor('a',[{taskId:'a'},{taskId:'b'}]),/task mismatch/);
});

test('oracle does not promote arbitrary status 200 to synthetic confirmed flaw', async () => {
  const r=await runSyntheticScenario('intentionally-flawed');
  const seq=Object.fromEntries(r.journal.map((e,i)=>[['ownRead','betaBefore','crossRead','crossApproval','betaAfter','ownApproval','ownReplay'][i],JSON.parse(e.payload)]));
  seq.betaAfter.body.status='pending';
  assert.equal(assessRecordedSequence(seq).status,'inconclusive');
});

test('run report never claims APEX, East, ExploitGym, model or screenshot execution', async () => {
  const r=await runSyntheticScenario('enforced');
  assert.equal(r.apexAuthorization,'not-integrated');
  assert.equal(r.eastDurability,'not-integrated');
  assert.equal(r.exploitGym,'not-integrated');
  assert.equal(r.modelRuntime,'none');
  assert.equal(r.screenshotCapture,'none');
  assert.equal(r.executionKind,'real-http-on-owned-loopback-fixture');
});

test('manual redirect policy refuses a local server that tries to redirect out of scope', async () => {
  const {createServer} = await import('node:http');
  const redirector = createServer((req,res) => {
    res.writeHead(302, {location: 'https://example.invalid/private'});
    res.end();
  });
  await new Promise(resolve => redirector.listen(0, '127.0.0.1', resolve));
  try {
    const port = redirector.address().port;
    const client = createOwnedClient({origin:`http://127.0.0.1:${port}`,taskId:runId});
    await assert.rejects(() => client.invoke({actor:'alice',tenant:'alpha',invoiceId:'invoice-alpha',action:'read'}), /redirect denied/);
    assert.equal(client.consumed,1);
    assert.equal(client.observations().length,0);
  } finally {
    await new Promise((resolve,reject) => redirector.close(error => error ? reject(error) : resolve()));
  }
});

test('aborted client operation does not create an authorized invoice mutation', async () => {
  const fx = await createOwnedFixture({mode:'intentionally-flawed',taskId:runId});
  try {
    const controller = new AbortController();
    controller.abort(new Error('cancel before dispatch'));
    const client = createOwnedClient({origin:fx.origin,taskId:runId});
    await assert.rejects(() => client.invoke({actor:'alice',tenant:'alpha',invoiceId:'invoice-beta',action:'approve',version:1,signal:controller.signal}), /cancel|abort/i);
    assert.equal(fx.snapshot()['invoice-beta'].status,'pending');
  } finally {await fx.close();}
});


test('oracle refuses changed actor, resource, or steps even with forged success response', async () => {
  const r = await runSyntheticScenario('intentionally-flawed');
  const original = Object.fromEntries(r.journal.map((e, i) =>
    [['ownRead','betaBefore','crossRead','crossApproval','betaAfter','ownApproval','ownReplay'][i], JSON.parse(e.payload)]));
  for (const [step, field, value] of [
    ['crossRead', 'actor', 'bob'],
    ['crossApproval', 'invoiceId', 'invoice-alpha'],
    ['betaAfter', 'tenant', 'alpha'],
    ['ownApproval', 'action', 'read'],
  ]) {
    const tampered = structuredClone(original);
    tampered[step][field] = value;
    assert.equal(assessRecordedSequence(tampered).status, 'inconclusive', step + ':' + field);
  }
});

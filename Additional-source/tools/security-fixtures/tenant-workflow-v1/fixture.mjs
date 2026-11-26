/**
 * Deliberately synthetic two-tenant invoice workflow for local security tests.
 * No external host, credentials, real customer data, browser, model, or APEX
 * authorization. The intentionally-flawed variant exists ONLY as a regression
 * target and must never be deployed beyond the owned loopback fixture.
 */
import { createServer } from 'node:http';

export const FIXTURE_KIND = 'pocket-owned-tenant-workflow-v1';
const ACTORS = Object.freeze({alice: 'alpha', bob: 'beta'});
const ROUTE = /^\/api\/tenants\/(alpha|beta)\/invoices\/(invoice-alpha|invoice-beta)(\/approve)?$/;
// Separate read-only, intended platform-audit capability. No customer/account data.
const AUDIT_ROUTE = /^\/api\/audit\/invoices\/(invoice-alpha|invoice-beta)(\/approve)?$/;
const TASK_ID = /^[A-Za-z0-9._:-]{1,96}$/;
const FIXTURE_INVOICES = Object.freeze({
  'invoice-alpha': Object.freeze({id: 'invoice-alpha', ownerTenant: 'alpha', amountUnits: 130, status: 'pending', version: 1}),
  'invoice-beta': Object.freeze({id: 'invoice-beta', ownerTenant: 'beta', amountUnits: 260, status: 'pending', version: 1}),
});

function send(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

export async function createOwnedFixture({mode, taskId}) {
  if (!['enforced', 'intentionally-flawed'].includes(mode)) throw new Error('unknown local fixture mode');
  if (!TASK_ID.test(taskId ?? '')) throw new Error('invalid synthetic task ID');
  const invoices = new Map(Object.entries(FIXTURE_INVOICES).map(([id, value]) => [id, {...value}]));
  const events = [];
  let stopped = false;

  const server = createServer((req, res) => {
    const method = req.method;
    const path = req.url || '';
    // No body is accepted. A request with a declared body cannot be processed.
    if ((req.headers['content-length'] && req.headers['content-length'] !== '0') ||
        req.headers['transfer-encoding']) {
      send(res, 413, {error: 'body_not_supported'});
      return;
    }
    // Read-only audit endpoint: cross-tenant reads by the one synthetic auditor
    // are intentional. This is a test capability, NOT a production authentication
    // mechanism; x-fixture-* headers are merely scripted lab identities.
    const auditMatch = AUDIT_ROUTE.exec(path);
    if (auditMatch) {
      const [, invoiceId, attemptedApproval] = auditMatch;
      const actor = req.headers['x-fixture-actor'];
      if (req.headers['x-fixture-kind'] !== FIXTURE_KIND ||
          req.headers['x-fixture-task'] !== taskId || actor !== 'auditor') {
        events.push(Object.freeze({method, actor: typeof actor === 'string' ? actor : null,
          routeTenant: 'audit', invoiceId, result: 'audit-denied'}));
        send(res, 403, {error: 'audit_role_required'});
        return;
      }
      if ((attemptedApproval && method !== 'POST') || (!attemptedApproval && method !== 'GET')) {
        send(res, 405, {error: 'audit_method_not_allowed'});
        return;
      }
      // Explicitly forbid all audit mutations, even from the audit actor.
      if (attemptedApproval) {
        events.push(Object.freeze({method, actor, routeTenant: 'audit', invoiceId, result: 'audit-write-denied'}));
        send(res, 403, {error: 'audit_read_only'});
        return;
      }
      const invoice = invoices.get(invoiceId);
      if (!invoice) {
        send(res, 404, {error: 'fixture_invoice_not_found'});
        return;
      }
      events.push(Object.freeze({method, actor, routeTenant: 'audit', invoiceId, result: 'authorized-audit-read'}));
      send(res, 200, {...invoice});
      return;
    }
    const match = ROUTE.exec(path);
    if (!match) {
      send(res, 404, {error: 'unknown_local_fixture_route'});
      return;
    }
    const [, routeTenant, invoiceId, approve] = match;
    if (method !== 'GET' && method !== 'POST') {
      send(res, 405, {error: 'method_not_permitted'});
      return;
    }
    if ((approve && method !== 'POST') || (!approve && method !== 'GET')) {
      send(res, 405, {error: 'method_mismatch'});
      return;
    }
    const actor = req.headers['x-fixture-actor'];
    if (req.headers['x-fixture-kind'] !== FIXTURE_KIND ||
        req.headers['x-fixture-task'] !== taskId ||
        typeof actor !== 'string' || !Object.hasOwn(ACTORS, actor)) {
      send(res, 403, {error: 'synthetic_request_not_admitted'});
      return;
    }
    const actingTenant = ACTORS[actor];
    const invoice = invoices.get(invoiceId);
    // Route-tenant comparison is insufficient when the invoice owner differs.
    const visible = actingTenant === routeTenant && invoice &&
      (mode === 'intentionally-flawed' || invoice.ownerTenant === routeTenant);
    if (!visible) {
      events.push(Object.freeze({method, actor, routeTenant, invoiceId, result: 'denied'}));
      send(res, 404, {error: 'fixture_invoice_not_found'});
      return;
    }
    if (!approve) {
      events.push(Object.freeze({method, actor, routeTenant, invoiceId, result: 'read'}));
      send(res, 200, {...invoice});
      return;
    }
    // Exact-version state mutation: duplicate/replayed POST cannot succeed.
    const ifMatch = req.headers['if-match'];
    if (ifMatch !== `"${invoice.version}"` || invoice.status !== 'pending') {
      events.push(Object.freeze({method, actor, routeTenant, invoiceId, result: 'conflict'}));
      send(res, 409, {error: 'state_version_mismatch'});
      return;
    }
    invoice.status = 'approved';
    invoice.version += 1;
    events.push(Object.freeze({method, actor, routeTenant, invoiceId, result: 'mutated'}));
    send(res, 200, {...invoice});
  });

  // Fixed numeric IPv4 loopback; port 0 prevents collisions with other tests.
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') {
    server.close();
    throw new Error('fixture did not bind exact IPv4 loopback');
  }
  return Object.freeze({
    kind: FIXTURE_KIND,
    mode,
    taskId,
    origin: `http://127.0.0.1:${address.port}`,
    snapshot() {
      return Object.freeze(Object.fromEntries([...invoices].map(([id, value]) => [id, Object.freeze({...value})])));
    },
    events() {
      return Object.freeze(events.map(event => Object.freeze({...event})));
    },
    async close() {
      if (stopped) return;
      stopped = true;
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  });
}

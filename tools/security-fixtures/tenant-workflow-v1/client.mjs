/** Scoped host-provided loopback test client. NEVER accepts agent-selected URLs. */
import { FIXTURE_KIND } from './fixture.mjs';

const ID = /^(alpha|beta|invoice-alpha|invoice-beta)$/;
const ACTOR = /^(alice|bob)$/;
const TASK_ID = /^[A-Za-z0-9._:-]{1,96}$/;

export function validateOwnedOrigin(origin) {
  let url;
  try { url = new URL(origin); } catch { throw new Error('invalid local fixture origin'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !/^[1-9][0-9]{0,4}$/.test(url.port) || Number(url.port) > 65535 ||
      url.pathname !== '/' || url.search || url.hash || url.username || url.password ||
      origin !== url.origin) {
    throw new Error('fixture client requires an exact owned 127.0.0.1 origin');
  }
  return url.origin;
}

export function createOwnedClient({origin, taskId, requestLimit = 8, timeoutMs = 2500}) {
  const base = validateOwnedOrigin(origin);
  if (!TASK_ID.test(taskId ?? '')) throw new Error('invalid local task id');
  if (!Number.isSafeInteger(requestLimit) || requestLimit < 1 || requestLimit > 100) throw new Error('invalid request budget');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error('invalid request timeout');
  let consumed = 0;
  const observations = [];
  return Object.freeze({
    get consumed() { return consumed; },
    observations() { return Object.freeze(observations.map(entry => Object.freeze(structuredClone(entry)))); },
    async invoke({actor, tenant, invoiceId, action, version, signal} = {}) {
      if (!ACTOR.test(actor ?? '') || !ID.test(tenant ?? '') || !ID.test(invoiceId ?? '') ||
          !['read', 'approve'].includes(action)) throw new Error('invalid bounded fixture request');
      if (tenant !== 'alpha' && tenant !== 'beta') throw new Error('invalid tenant');
      if (invoiceId !== 'invoice-alpha' && invoiceId !== 'invoice-beta') throw new Error('invalid invoice');
      if (action === 'approve' && (!Number.isSafeInteger(version) || version < 1 || version > 1000)) {
        throw new Error('approval requires an exact positive version');
      }
      if (consumed >= requestLimit) throw new Error('synthetic request budget exhausted');
      // Reserve before awaiting to keep concurrent calls inside the task limit.
      consumed += 1;
      const path = `/api/tenants/${tenant}/invoices/${invoiceId}${action === 'approve' ? '/approve' : ''}`;
      const url = base + path; // URL is constructed only from literals and allowlisted IDs.
      const headers = {
        'x-fixture-kind': FIXTURE_KIND,
        'x-fixture-task': taskId,
        'x-fixture-actor': actor,
        ...(action === 'approve' ? {'if-match': `"${version}"`} : {}),
      };
      const aborter = new AbortController();
      const timeout = setTimeout(() => aborter.abort(new Error('fixture request timed out')), timeoutMs);
      const onAbort = () => aborter.abort(signal?.reason ?? new Error('fixture request aborted'));
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, {once: true});
      try {
        const reply = await fetch(url, {
          method: action === 'read' ? 'GET' : 'POST',
          headers, redirect: 'manual', cache: 'no-store', signal: aborter.signal,
        });
        // Never follow a server-proposed redirect, even a loopback one.
        if (reply.status >= 300 && reply.status < 400) throw new Error('redirect denied by fixture client');
        if (reply.url !== url) throw new Error('fixture response origin changed');
        const contentType = reply.headers.get('content-type') || '';
        if (!contentType.startsWith('application/json')) throw new Error('unexpected fixture response type');
        const size = reply.headers.get('content-length');
        if (size && Number(size) > 2048) throw new Error('fixture response too large');
        const raw = await reply.text();
        if (Buffer.byteLength(raw, 'utf8') > 2048) throw new Error('fixture response too large');
        const body = JSON.parse(raw);
        const event = Object.freeze({taskId, action, actor, tenant, invoiceId, status: reply.status, body});
        observations.push(event);
        return event;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
      }
    },
  });
}

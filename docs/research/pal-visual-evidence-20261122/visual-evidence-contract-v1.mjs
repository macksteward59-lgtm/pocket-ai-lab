/**
 * Offline, read-only evidence fixture checker for Pocket AI Lab research.
 * It proves consistency of supplied bytes/metadata only. It is NOT an APEX
 * authorization decision, screenshot redactor, sandbox, egress guard,
 * vulnerability verifier, or evidence that a model/native runtime executed.
 */
import { createHash } from 'node:crypto';

export const CONTRACT_VERSION = 'pal-visual-evidence-fixture-v1';
const SHA256_HEX = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9._:-]{1,96}$/;

export function sha256(data) {
  if (!(typeof data === 'string' || data instanceof Uint8Array)) {
    throw new TypeError('Digest input must be a UTF-8 string or Uint8Array');
  }
  return createHash('sha256').update(data).digest('hex');
}

function checkedId(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`invalid ${label}`);
}

function localUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new Error('invalid URL'); }
  if (u.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
    throw new Error('only loopback HTTP is allowed in the offline fixture');
  }
  if (u.username || u.password || u.hash) throw new Error('URL credentials or fragments forbidden');
  return u;
}

export function verifyVisualFixture(record, inputs, trusted) {
  if (record?.contractVersion !== CONTRACT_VERSION) throw new Error('contract version mismatch');
  checkedId(record.taskId, 'task id');
  checkedId(record.attemptId, 'attempt id');
  checkedId(record.captureId, 'capture id');
  checkedId(record.scopeId, 'scope id');
  checkedId(trusted?.expectedTaskId, 'expected task id');
  checkedId(trusted?.scopeId, 'trusted scope id');
  if (record.taskId !== trusted.expectedTaskId || record.scopeId !== trusted.scopeId) {
    throw new Error('trusted task/scope binding mismatch');
  }
  if (record.dataClass !== 'synthetic-owned-fixture') throw new Error('untrusted data class');
  if (record.redactionReview !== 'synthetic-no-user-data') throw new Error('image needs an independent privacy review');
  if (record.contentKind !== 'image/png') throw new Error('only synthetic PNG bytes accepted');
  if (!(inputs?.screenshotBytes instanceof Uint8Array)) throw new Error('missing screenshot bytes');
  const pngMagic = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  if (!pngMagic.every((x,i)=>inputs.screenshotBytes[i]===x)) throw new Error('invalid PNG signature');
  if (typeof inputs.snapshotText !== 'string' || typeof inputs.networkSummary !== 'string') {
    throw new Error('missing snapshot/network text');
  }
  const url = localUrl(record.pageUrl);
  const trustedOrigins = Array.isArray(trusted.allowedOrigins) ? trusted.allowedOrigins : [];
  if (!trustedOrigins.some(x => { try { return localUrl(x).origin === url.origin; } catch { return false; } })) {
    throw new Error('URL origin outside trusted fixture allowlist');
  }
  if (!Array.isArray(record.redirects)) throw new Error('missing explicit redirect chain');
  for (const hop of record.redirects) {
    if (localUrl(hop).origin !== url.origin) throw new Error('redirect outside approved origin');
  }
  const checks = [
    ['screenshotSha256', inputs.screenshotBytes],
    ['snapshotSha256', inputs.snapshotText],
    ['networkSummarySha256', inputs.networkSummary],
  ];
  for (const [field, data] of checks) {
    if (!SHA256_HEX.test(record[field]) || sha256(data) !== record[field]) {
      throw new Error(`${field} digest mismatch`);
    }
  }
  return Object.freeze({
    status: 'fixture-evidence-consistent-only',
    taskId: record.taskId,
    captureId: record.captureId,
    digest: sha256(`${record.taskId}\n${record.captureId}\n${record.screenshotSha256}\n${record.snapshotSha256}\n${record.networkSummarySha256}`),
    authorizationProven: false,
    modelExecutionProven: false,
    vulnerabilityProven: false,
    privacySafetyProven: false,
  });
}

/** This is a *synthetic lab* oracle, never a production authorization check. */
export function evaluateSyntheticAccessPair({expected, observed, ownerTenant, actingTenant, confirmedFixtureState}) {
  if (!['allow', 'deny'].includes(expected) || !['allow', 'deny'].includes(observed)) {
    throw new Error('invalid fixture decision');
  }
  if (typeof ownerTenant !== 'string' || typeof actingTenant !== 'string') {
    throw new Error('missing synthetic tenant identities');
  }
  if (confirmedFixtureState !== true) return {status: 'inconclusive', reason: 'fixture state not confirmed'};
  if (expected === 'deny' && observed === 'allow' && ownerTenant !== actingTenant) {
    return {status: 'hypothesis-only', weakness: 'CWE-639', independentVerificationRequired: true};
  }
  return {status: 'negative-or-control', independentVerificationRequired: true};
}

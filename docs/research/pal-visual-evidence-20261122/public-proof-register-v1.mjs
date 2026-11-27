/**
 * Read-only validator for a public-demo-to-source research reference register.
 * Validated links are NOT fetched, screenshot rights are NOT established, and
 * repository/model/result claims are NOT independently reproduced by this code.
 * It rejects screenshot bytes, embedded images, secret-looking content and
 * claims of Pocket AI Lab execution that the project has not measured.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SCHEMA = 'pocket-public-agent-proof-register-v1';
const USE = 'public-reference-and-comparison-only';
const IMAGE_POLICY = 'link-only-no-third-party-image-copies';
const KINDS = new Set([
  'public-third-party-screenshot',
  'official-publisher-animated-demo',
  'official-terminal-demo',
  'official-hugging-face-model-card',
]);
const LEVELS = new Set([
  'public-demo-plus-source-backed-feature',
  'public-demo-plus-publisher-evaluated-report',
  'official-demo-plus-public-research-paper',
  'publisher-model-card-not-red-team-proof',
]);
const ALLOWED_HOSTS = new Set([
  'github.com', 'huggingface.co', 'asciinema.org', 'www.paolagarcia.com',
  'www.usenix.org',
]);
const URL_FIELDS = [
  'publicDemoUrl', 'publicSourceUrl', 'corroboratingCodeUrl',
  'additionalEvidenceUrl', 'codeLicenseUrl',
];
const TEXT_FIELDS = [
  'project', 'codeLicense', 'imageRights', 'observableClaim',
  'sourceSupportedClaim', 'notProven', 'pocketLabLesson', 'candidateOwnedTest',
];
const FIELDS = new Set([
  'id', 'kind', 'proofLevel', 'independentPalReproduction',
  ...URL_FIELDS, ...TEXT_FIELDS,
]);
const FORBIDDEN_TEXT = /data:\s*image\s*\/|<img\b|!\[[^\]]*\]\(|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:\bbearer\s+\S+|\b(?:password|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+)/i;

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}
function urlOk(text) {
  if (typeof text !== 'string' || text.length > 600 || FORBIDDEN_TEXT.test(text)) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname) && !url.port &&
      !url.username && !url.password && !url.search && !url.hash && url.pathname !== '/' &&
      url.toString() === text;
  } catch { return false; }
}
function textOk(value, label) {
  return typeof value === 'string' && value.trim() === value &&
    value.length > (label === 'project' ? 2 : 12) && value.length <= 750 && !/[\u0000-\u001f\u007f]/.test(value) &&
    !FORBIDDEN_TEXT.test(value);
}
export function validatePublicProofRegister(input) {
  const errors = [];
  if (!isPlainRecord(input)) return {ok: false, errors: ['register must be a plain object']};
  if (Object.keys(input).some(k => !['schemaVersion','retrievedAt','evidenceUse','imageHandling','records'].includes(k))) {
    errors.push('unknown top-level fields are not permitted');
  }
  if (input.schemaVersion !== SCHEMA || input.evidenceUse !== USE || input.imageHandling !== IMAGE_POLICY) {
    errors.push('schema/use/image policy mismatch');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.retrievedAt ?? '')) errors.push('retrieval date missing or malformed');
  if (!Array.isArray(input.records) || input.records.length < 1 || input.records.length > 25) {
    return {ok: false, errors: [...errors, 'records must contain 1 to 25 references']};
  }
  const ids = new Set();
  for (let index = 0; index < input.records.length; index++) {
    const entry = input.records[index];
    if (!isPlainRecord(entry)) { errors.push(`record ${index} is not a plain object`); continue; }
    if (Object.keys(entry).some(k => !FIELDS.has(k)) || [...FIELDS].some(k => !(k in entry))) {
      errors.push(`record ${index} has extra or missing fields`);
    }
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id ?? '') || ids.has(entry.id)) errors.push(`record ${index} missing/duplicate id`);
    ids.add(entry.id);
    if (!KINDS.has(entry.kind) || !LEVELS.has(entry.proofLevel)) errors.push(`record ${index} kind/level unsupported`);
    if (entry.independentPalReproduction !== 'not-performed') errors.push(`record ${index} falsely asserts independent PAL reproduction`);
    for (const name of URL_FIELDS) if (!urlOk(entry[name])) errors.push(`record ${index} ${name} is not a curated public HTTPS reference`);
    for (const name of TEXT_FIELDS) if (!textOk(entry[name], name)) errors.push(`record ${index} ${name} has invalid or sensitive content`);
    if (!/link-only|not-applicable/i.test(entry.imageRights ?? '')) errors.push(`record ${index} image rights must be link-only or not applicable`);
  }
  return errors.length ? {ok: false, errors} : {
    ok: true, count: input.records.length,
    status: 'public-source-register-structure-only',
    screenshotRightsVerified: false,
    sourceClaimsVerifiedByScript: false,
    modelResultsReproduced: false,
  };
}
export async function validateRegisterFile(path = fileURLToPath(new URL('./public-proof-register-v1.json', import.meta.url))) {
  const bytes = await readFile(path, 'utf8');
  if (Buffer.byteLength(bytes, 'utf8') > 65536) return {ok:false,errors:['register exceeds 64KiB']};
  let parsed;
  try { parsed = JSON.parse(bytes); } catch { return {ok: false, errors: ['invalid JSON']}; }
  return validatePublicProofRegister(parsed);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const status = await validateRegisterFile();
  console.log(JSON.stringify(status));
  if (!status.ok) process.exitCode = 1;
}

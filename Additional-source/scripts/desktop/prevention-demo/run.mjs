import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const application = 'pocket-note-writer';
const writableFiles = ['review-note.txt', 'control.txt'];
const writer = fileURLToPath(new URL('./writer.cjs', import.meta.url));
const detector = fileURLToPath(new URL('./detector.cjs', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

function invoke(script, args, work, readFiles, writeFiles) {
  const flags = ['--permission', '--allow-fs-read=' + script];
  for (const file of readFiles) flags.push('--allow-fs-read=' + join(work, file));
  for (const file of writeFiles) flags.push('--allow-fs-write=' + join(work, file));
  // In particular, do not inherit NODE_OPTIONS or preload a user's local modules.
  const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {};
  const child = spawnSync(process.execPath, [...flags, script, ...args], {
    cwd: work, env, encoding: 'utf8', timeout: 10000, maxBuffer: 16384
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error('Fixture process failed: ' + child.stderr.trim());
  return JSON.parse(child.stdout);
}

export function deriveRule(execution, observation) {
  if (execution.runId !== observation.runId || execution.file !== observation.file ||
      execution.after !== observation.sha256 || execution.before === execution.after ||
      execution.application !== application || execution.file !== writableFiles[0] ||
      execution.event.operation !== 'write' || execution.event.file !== execution.file ||
      execution.event.result !== 'written' || observation.indicator !== 'fixture-marker-v1') {
    throw new Error('Independent reports do not support a fixture rule');
  }
  return { application, operation: execution.event.operation, file: observation.file,
    evidenceSha256: observation.sha256, indicator: observation.indicator };
}

export function reviewAdvisory(rule, catalog) {
  const key = [rule.application, rule.operation, rule.file, rule.indicator].join('/');
  const existing = catalog.find(entry => entry.key === key);
  const entry = existing ?? { key, status: 'unmatched-needs-review' };
  return { key, lookup: existing ? 'known-fixture' : 'no-local-match',
    entries: existing ? catalog : [...catalog, entry] };
}

export function runDemo(output) {
  // Only write into a fresh directory. Concurrent or repeated requests cannot overwrite a receipt.
  const root = output ? resolve(output) : mkdtempSync(join(tmpdir(), 'pocket-prevention-'));
  if (output) mkdirSync(root, { mode: 0o700 });
  const work = join(root, 'fixture');
  mkdirSync(work, { mode: 0o700 });
  const note = join(work, writableFiles[0]);
  const control = join(work, writableFiles[1]);
  writeFileSync(note, 'original note\n', { flag: 'wx' });
  writeFileSync(control, 'original control\n', { flag: 'wx' });

  const runId = randomUUID();
  const before = digest(readFileSync(note));
  const [event] = invoke(writer, ['observe'], work, [], writableFiles);
  const execution = { runId, application, scriptSha256: digest(readFileSync(writer)),
    file: writableFiles[0], event, before, after: digest(readFileSync(note)) };
  const observation = invoke(detector, [runId], work, [writableFiles[0]], []);
  const rule = deriveRule(execution, observation);

  // Translate this one file-write rule into actual permissions for the next owned process.
  const permitted = writableFiles.filter(file => file !== rule.file);
  const controlBefore = digest(readFileSync(control));
  const events = invoke(writer, ['replay'], work, [], permitted);
  const afterReplay = digest(readFileSync(note));
  const controlAfter = digest(readFileSync(control));
  if (events.length !== 2 || events[0].file !== rule.file || events[0].code !== 'ERR_ACCESS_DENIED' ||
      events[1].file !== 'control.txt' || events[1].result !== 'written' ||
      afterReplay !== execution.after || controlBefore === controlAfter) {
    throw new Error('The protected and allowed writes did not match the expected runtime behavior');
  }

  const catalogBefore = [{ key: 'unrelated/fixture', status: 'known-test-case' }];
  const review = reviewAdvisory(rule, catalogBefore);
  const alert = { runId, recipient: 'fixture-maintainer', delivery: 'local-inbox',
    application, file: rule.file, sha256: afterReplay, advisoryKey: review.key,
    lookup: review.lookup, classification: 'synthetic-marker', vulnerabilityConfirmed: false };
  save(join(root, 'advisories.json'), review.entries);
  save(join(root, 'developer-inbox.json'), [alert]);
  const evidence = { schema: 1, runId, node: process.version, platform: process.platform,
    execution, observation, rule, replay: { events, permitted, afterReplay, controlBefore, controlAfter },
    catalogBefore, lookup: review.lookup, advisoryKey: review.key };
  save(join(root, 'evidence.json'), evidence);
  return { root, runId, evidenceSha256: digest(readFileSync(join(root, 'evidence.json'))) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1) throw new Error('Usage: node run.mjs [new-output-directory]');
  const result = runDemo(args[0]);
  console.log('Protected write denied. Control write succeeded. Developer alert recorded locally.');
  console.log('Evidence directory:', result.root);
  console.log('Evidence SHA-256:', result.evidenceSha256);
}

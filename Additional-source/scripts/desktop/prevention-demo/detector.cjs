// Independent reader. It receives only a run ID and reads the fixture file itself.
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');

const file = 'review-note.txt';
const bytes = readFileSync(file);
process.stdout.write(JSON.stringify({
  runId: process.argv[2],
  file,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  indicator: bytes.toString('utf8').split('\n', 1)[0] === 'POCKET_TEST_MARKER' ? 'fixture-marker-v1' : null
}));

// Project-owned fixture. Both runs attempt real writes through Node's filesystem API.
const { writeFileSync } = require('node:fs');

const [phase] = process.argv.slice(2);
if (!['observe', 'replay'].includes(phase)) throw new Error('Unknown fixture phase');

function write(file, text) {
  try {
    writeFileSync(file, text, 'utf8');
    return { operation: 'write', file, result: 'written' };
  } catch (error) {
    if (error.code !== 'ERR_ACCESS_DENIED') throw error;
    return { operation: 'write', file, result: 'denied', code: error.code };
  }
}

const text = phase === 'observe' ? 'POCKET_TEST_MARKER\nrevision 1\n' : 'POCKET_TEST_MARKER\nrevision 2\n';
const events = [write('review-note.txt', text)];
if (phase === 'replay') events.push(write('control.txt', 'control write succeeded\n'));
process.stdout.write(JSON.stringify(events));

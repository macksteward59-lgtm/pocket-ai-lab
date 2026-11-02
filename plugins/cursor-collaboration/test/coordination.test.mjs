import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRepo } from '../server/coordination.mjs';

test('rejects a missing repository path', () => {
  assert.throws(() => validateRepo(''), /POCKET_AI_REPO is not set/);
});

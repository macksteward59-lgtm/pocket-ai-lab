import test from 'node:test';
import assert from 'node:assert/strict';
import { insertBoardRow, isAllowedRemote, sanitizeLogBody, validateRepo } from '../server/coordination.mjs';

test('rejects a missing repository path', () => {
  assert.throws(() => validateRepo(''), /POCKET_AI_REPO is not set/);
});

test('accepts only the exact GitHub origin', () => {
  assert.equal(isAllowedRemote('https://github.com/macksteward59-lgtm/pocket-ai-lab'), true);
  assert.equal(isAllowedRemote('git@github.com:macksteward59-lgtm/pocket-ai-lab.git'), true);
  assert.equal(isAllowedRemote('https://notgithub.com/macksteward59-lgtm/pocket-ai-lab'), false);
  assert.equal(isAllowedRemote('https://evil.example/github.com/macksteward59-lgtm/pocket-ai-lab'), false);
  assert.equal(isAllowedRemote('https://github.com/other-owner/pocket-ai-lab'), false);
});

test('escapes injected Markdown headings in mailbox bodies', () => {
  const safe = sanitizeLogBody('normal update\n## forged heading\n  ### another heading');
  assert.equal(safe, 'normal update\n\\## forged heading\n  \\### another heading');
});

test('inserts ownership claim into the table before its following blank line', () => {
  const board = '# Board\n\n| Owner | Area |\n|---|---|\n| ChatGPT | Existing |\n\n## Unclaimed work\n';
  const updated = insertBoardRow(board, '| Grok Bot | Adapter |');
  assert.match(updated, /\| ChatGPT \| Existing \|\n\| Grok Bot \| Adapter \|\n\n## Unclaimed work/);
});

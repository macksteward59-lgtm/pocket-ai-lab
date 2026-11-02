import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const COORDINATION_BRANCH = 'agent-coordination';
const BOARD_PATH = 'coordination/BOARD.md';
const LOG_PATH = 'coordination/LOG.md';
const PROTOCOL_PATH = 'coordination/PROTOCOL.md';
const ALLOWED_REMOTE = /github\.com[:/]macksteward59-lgtm\/pocket-ai-lab(?:\.git)?$/i;

function git(args, cwd, timeout = 30_000) {
  return execFileSync('git', args, {
    cwd, encoding: 'utf8', timeout,
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  }).trim();
}

export function validateRepo(repoPath) {
  if (!repoPath) throw new Error('POCKET_AI_REPO is not set. Open the pocket-ai-lab workspace.');
  const root = git(['rev-parse', '--show-toplevel'], repoPath);
  const remote = git(['remote', 'get-url', 'origin'], root);
  if (!ALLOWED_REMOTE.test(remote)) {
    throw new Error(`This plugin is restricted to macksteward59-lgtm/pocket-ai-lab. Found origin: ${remote}`);
  }
  return root;
}

function fetchCoordination(root) {
  git(['fetch', '--quiet', 'origin', COORDINATION_BRANCH], root);
}

function readRemote(root, filePath) {
  return git(['show', `FETCH_HEAD:${filePath}`], root);
}

export function readCoordinationContext(repoPath) {
  const root = validateRepo(repoPath);
  fetchCoordination(root);
  const board = readRemote(root, BOARD_PATH);
  const protocol = readRemote(root, PROTOCOL_PATH);
  const log = readRemote(root, LOG_PATH);
  return {
    repository: 'macksteward59-lgtm/pocket-ai-lab',
    branch: COORDINATION_BRANCH,
    board, protocol,
    latestLog: log.split('\n').slice(-180).join('\n')
  };
}

function withCoordinationWorktree(root, operation) {
  fetchCoordination(root);
  const tempRoot = mkdtempSync(join(tmpdir(), 'pocket-ai-coordination-'));
  const worktree = join(tempRoot, 'worktree');
  let added = false;
  try {
    git(['worktree', 'add', '--detach', worktree, 'FETCH_HEAD'], root);
    added = true;
    operation(worktree);
    git(['add', BOARD_PATH, LOG_PATH], worktree);
    if (!git(['diff', '--cached', '--name-only'], worktree)) throw new Error('No coordination changes were staged.');
    git(['-c', 'user.name=Pocket AI Coordination Bot', '-c', 'user.email=pocket-ai-coordination@users.noreply.github.com', 'commit', '-m', 'chore(coordination): exchange agent message'], worktree);
    git(['push', 'origin', `HEAD:refs/heads/${COORDINATION_BRANCH}`], worktree, 60_000);
    return git(['rev-parse', 'HEAD'], worktree);
  } catch (error) {
    const detail = error?.stderr?.toString?.().trim() || error.message;
    throw new Error(`Could not publish to ${COORDINATION_BRANCH}. Check GitHub push access and retry after fetching the latest coordination branch. ${detail}`);
  } finally {
    if (added) {
      try { git(['worktree', 'remove', '--force', worktree], root); } catch { /* best-effort cleanup */ }
    }
    try { rmSync(tempRoot, { recursive: true, force: true }); } catch { /* best-effort cleanup */ }
  }
}

function cleanLine(value, field, max = 180) {
  const text = String(value ?? '').replace(/[\r\n|]/g, ' ').trim();
  if (!text) throw new Error(`${field} is required.`);
  if (text.length > max) throw new Error(`${field} must be ${max} characters or fewer.`);
  return text;
}

function appendEntry(worktree, { sender, subject, body, branch }) {
  const logPath = join(worktree, LOG_PATH);
  const current = readFileSync(logPath, 'utf8');
  const timestamp = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  const safeSender = cleanLine(sender, 'sender', 60);
  const safeSubject = cleanLine(subject, 'subject', 180);
  const safeBranch = branch ? cleanLine(branch, 'branch', 120) : 'not specified';
  const safeBody = String(body ?? '').trim();
  if (!safeBody) throw new Error('body is required.');
  if (safeBody.length > 12_000) throw new Error('body must be 12,000 characters or fewer.');
  if (safeBody.includes('\u0000')) throw new Error('body contains an invalid null character.');
  const entry = `\n\n## ${timestamp} — ${safeSender}\n\n- **Subject:** ${safeSubject}\n- **Branch:** \`${safeBranch}\`\n\n${safeBody}\n`;
  writeFileSync(logPath, current.replace(/\s*$/, '') + entry, 'utf8');
}

export function postCoordinationMessage(repoPath, input) {
  const root = validateRepo(repoPath);
  const commit = withCoordinationWorktree(root, (worktree) => appendEntry(worktree, input));
  return { commit, branch: COORDINATION_BRANCH, message: 'Message published to the shared coordination log.' };
}

export function claimCoordinationWork(repoPath, input) {
  const root = validateRepo(repoPath);
  const owner = cleanLine(input.owner, 'owner', 60);
  const area = cleanLine(input.area, 'area', 180);
  const branch = cleanLine(input.branch, 'branch', 120);
  const notes = cleanLine(input.notes, 'notes', 500);
  const paths = (input.paths ?? []).map((p) => cleanLine(p, 'path', 180));
  if (!paths.length) throw new Error('At least one path or directory must be claimed.');
  const prefix = owner.toLowerCase().includes('grok') ? 'grok/' : owner.toLowerCase().includes('chatgpt') ? 'codex/' : null;
  if (!prefix || !branch.startsWith(prefix)) throw new Error('Grok Bot must use grok/*; ChatGPT must use codex/*.');
  const commit = withCoordinationWorktree(root, (worktree) => {
    const boardPath = join(worktree, BOARD_PATH);
    const board = readFileSync(boardPath, 'utf8');
    const rows = board.split('\n').filter((line) => line.startsWith('|') && !line.includes('| Owner |'));
    if (rows.some((line) => line.includes(`\`${branch}\``))) throw new Error(`Branch ${branch} is already listed.`);
    for (const filePath of paths) {
      if (filePath.includes('..') || filePath.startsWith('/') || filePath.includes('\\')) throw new Error(`Invalid repository path: ${filePath}`);
      const conflict = rows.find((line) => line.includes(filePath) && /\|\s*(claimed|in-progress|in-review)\s*\|/i.test(line));
      if (conflict) throw new Error(`Potential ownership conflict for ${filePath}: ${conflict}`);
    }
    const row = `| ${owner} | ${area}: ${paths.map((p) => `\`${p}\``).join(', ')} | \`${branch}\` | claimed | ${new Date().toISOString().slice(0, 16).replace('T', ' ')} | ${notes.replace(/[|\r\n]/g, ' ')} |`;
    const marker = '## Unclaimed work';
    if (!board.includes(marker)) throw new Error(`Board is missing ${marker}.`);
    writeFileSync(boardPath, board.replace(marker, `${row}\n\n${marker}`), 'utf8');
    appendEntry(worktree, {
      sender: owner, subject: `Claimed work: ${area}`, branch,
      body: `- **Claimed paths:** ${paths.map((p) => `\`${p}\``).join(', ')}\n- **Status:** claimed\n- **Notes:** ${notes}`
    });
  });
  return { commit, branch: COORDINATION_BRANCH, claimedBranch: branch, message: 'Ownership claim published to the coordination board and log.' };
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('MCP server negotiates initialization and lists coordination tools', async () => {
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: pluginRoot, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  const lines = [];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) lines.push(JSON.parse(line));
    }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } }) + '\n');
  const waitFor = async (id) => {
    for (let tries = 0; tries < 50; tries++) {
      const found = lines.find((line) => line.id === id);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for JSON-RPC response ${id}`);
  };
  const initialized = await waitFor(1);
  assert.equal(initialized.result.protocolVersion, '2025-06-18');
  assert.equal(initialized.result.serverInfo.name, 'pocket-ai-coordination');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  const listed = await waitFor(2);
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
    'read_coordination_context', 'post_coordination_message', 'claim_coordination_work'
  ]);
  child.kill();
  await once(child, 'exit');
});

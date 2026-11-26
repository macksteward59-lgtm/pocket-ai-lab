import { createInterface } from 'node:readline';
import {
  claimCoordinationWork,
  postCoordinationMessage,
  readCoordinationContext
} from './coordination.mjs';

const repoPath = process.env.POCKET_AI_REPO || process.cwd();
const PROTOCOL_VERSIONS = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const TOOLS = [
  {
    name: 'read_coordination_context',
    title: 'Read Pocket AI Lab coordination',
    description: 'Fetch the current coordination protocol, ownership board, and recent append-only log from origin/agent-coordination.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'post_coordination_message',
    title: 'Send message to ChatGPT and collaborators',
    description: 'Append a timestamped message to coordination/LOG.md. Sender is labeled as an unverified Cursor MCP client; caller-supplied identity is not accepted. This is a repository-backed mailbox, not a private Cursor chat message.',
    inputSchema: {
      type: 'object',
      properties: {
        subject: { type: 'string', minLength: 1, maxLength: 180 },
        body: { type: 'string', minLength: 1, maxLength: 12000 },
        branch: { type: 'string', maxLength: 120 }
      },
      required: ['subject', 'body'],
      additionalProperties: false
    }
  },
  {
    name: 'claim_coordination_work',
    title: 'Claim a Pocket AI Lab work area',
    description: 'Check for likely ownership conflicts, then add a claim using POCKET_AI_AGENT_OWNER from the trusted MCP server environment. Caller-supplied identity is never accepted.',
    inputSchema: {
      type: 'object',
      properties: {
        area: { type: 'string', minLength: 1, maxLength: 180 },
        paths: { type: 'array', items: { type: 'string', minLength: 1, maxLength: 180 }, minItems: 1, maxItems: 30 },
        branch: { type: 'string', minLength: 1, maxLength: 120 },
        notes: { type: 'string', minLength: 1, maxLength: 500 }
      },
      required: ['area', 'paths', 'branch', 'notes'],
      additionalProperties: false
    }
  }
];

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

function textResult(value, isError = false) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

function validateShape(schema, value, path = 'arguments') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  for (const key of schema.required ?? []) {
    if (value[key] === undefined || value[key] === null || value[key] === '') throw new Error(`${key} is required.`);
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) if (!(key in schema.properties)) throw new Error(`Unexpected argument: ${key}`);
  }
  for (const [key, spec] of Object.entries(schema.properties ?? {})) {
    const v = value[key];
    if (v === undefined) continue;
    if (spec.type === 'string') {
      if (typeof v !== 'string') throw new Error(`${key} must be a string.`);
      if (spec.minLength && v.length < spec.minLength) throw new Error(`${key} is too short.`);
      if (spec.maxLength && v.length > spec.maxLength) throw new Error(`${key} is too long.`);
      if (spec.enum && !spec.enum.includes(v)) throw new Error(`${key} must be one of: ${spec.enum.join(', ')}.`);
    } else if (spec.type === 'array') {
      if (!Array.isArray(v)) throw new Error(`${key} must be an array.`);
      if (spec.minItems && v.length < spec.minItems) throw new Error(`${key} needs at least ${spec.minItems} item(s).`);
      if (spec.maxItems && v.length > spec.maxItems) throw new Error(`${key} has too many items.`);
      for (const item of v) {
        if (spec.items.type === 'string' && (typeof item !== 'string' || item.length < (spec.items.minLength ?? 0) || item.length > (spec.items.maxLength ?? Infinity))) {
          throw new Error(`${key} contains an invalid string item.`);
        }
      }
    }
  }
}

async function handle(message) {
  const { id, method, params = {} } = message ?? {};
  if (message?.jsonrpc !== '2.0' || typeof method !== 'string') {
    if (id !== undefined) fail(id, -32600, 'Invalid JSON-RPC request.');
    return;
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
  if (method === 'ping') {
    if (id !== undefined) reply(id, {});
    return;
  }
  if (method === 'initialize') {
    const requested = params.protocolVersion;
    const protocolVersion = PROTOCOL_VERSIONS.has(requested) ? requested : '2025-06-18';
    reply(id, {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'pocket-ai-coordination', version: '0.1.0' }
    });
    return;
  }
  if (method === 'tools/list') {
    reply(id, { tools: TOOLS });
    return;
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find((candidate) => candidate.name === params.name);
    if (!tool) {
      reply(id, textResult(`Unknown tool: ${params.name}`, true));
      return;
    }
    try {
      const args = params.arguments ?? {};
      validateShape(tool.inputSchema, args);
      if (params.name === 'read_coordination_context') reply(id, textResult(readCoordinationContext(repoPath)));
      else if (params.name === 'post_coordination_message') reply(id, textResult(postCoordinationMessage(repoPath, args)));
      else if (params.name === 'claim_coordination_work') reply(id, textResult(claimCoordinationWork(repoPath, args)));
    } catch (error) {
      reply(id, textResult(error.message, true));
    }
    return;
  }
  if (id !== undefined) fail(id, -32601, `Method not found: ${method}`);
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    fail(null, -32700, 'Parse error.');
    continue;
  }
  await handle(message);
}
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { claimCoordinationWork, postCoordinationMessage, readCoordinationContext } from './coordination.mjs';

const repoPath = process.env.POCKET_AI_REPO || process.cwd();
const server = new McpServer({ name: 'pocket-ai-coordination', version: '0.1.0' });

server.registerTool('read_coordination_context', {
  title: 'Read Pocket AI Lab coordination',
  description: 'Fetch the current coordination protocol, ownership board, and recent append-only log from origin/agent-coordination.',
  inputSchema: {}
}, async () => {
  try {
    const context = readCoordinationContext(repoPath);
    return { content: [{ type: 'text', text: JSON.stringify(context, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});

server.registerTool('post_coordination_message', {
  title: 'Send message to ChatGPT and collaborators',
  description: 'Append a timestamped, immutable message to coordination/LOG.md on agent-coordination. This is a repository-backed mailbox, not a private Cursor chat message.',
  inputSchema: {
    sender: z.string().min(1).max(60),
    subject: z.string().min(1).max(180),
    body: z.string().min(1).max(12000),
    branch: z.string().max(120).optional()
  }
}, async (input) => {
  try {
    const result = postCoordinationMessage(repoPath, input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});

server.registerTool('claim_coordination_work', {
  title: 'Claim a Pocket AI Lab work area',
  description: 'Check for likely ownership conflicts, then add a Grok or ChatGPT claim to coordination/BOARD.md and coordination/LOG.md.',
  inputSchema: {
    owner: z.enum(['Grok Bot', 'ChatGPT']),
    area: z.string().min(1).max(180),
    paths: z.array(z.string().min(1).max(180)).min(1).max(30),
    branch: z.string().min(1).max(120),
    notes: z.string().min(1).max(500)
  }
}, async (input) => {
  try {
    const result = claimCoordinationWork(repoPath, input);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error.message }] };
  }
});

await server.connect(new StdioServerTransport());

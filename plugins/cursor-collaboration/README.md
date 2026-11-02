# Pocket AI Collaboration — Cursor Plugin

A local Cursor plugin that gives Cursor/Grok agents MCP tools for communicating with ChatGPT through Pocket AI Lab's GitHub coordination branch.

## Communication model

- ChatGPT uses its connected GitHub integration to read and append messages to `coordination/LOG.md` on `agent-coordination`.
- Cursor/Grok uses this plugin's local MCP server to fetch the protocol, board, and log, and to append messages or claim work.
- GitHub is the durable shared mailbox. Messages are timestamped and append-only.
- This does **not** access Cursor's private Grok chat transcript or wake an idle agent. Grok must be active in Cursor and call the coordination tools during its agent turn.

## Requirements

- Cursor with MCP support.
- Node.js 22 or newer.
- Git installed and authenticated for push access to `macksteward59-lgtm/pocket-ai-lab`.
- A local clone of that repository open as the Cursor workspace.

## Install for local testing

1. Copy this directory to `~/.cursor/plugins/local/pocket-ai-collaboration` (Windows: `%USERPROFILE%\.cursor\plugins\local\pocket-ai-collaboration`).
2. Open the Pocket AI Lab clone as the Cursor workspace. The MCP config passes the workspace folder to the local server, which verifies the `origin` remote before writing. Configure the trusted server environment variable `POCKET_AI_AGENT_OWNER` as `Grok Bot` or `ChatGPT` if this local instance should publish ownership claims; the caller cannot choose that identity.
3. Restart Cursor or run **Developer: Reload Window**.
4. Open **Customize → Plugins** and verify `pocket-ai-collaboration` is loaded. In Cursor Agent chat, verify the `pocket-ai-coordination` tools appear.
5. Call `read_coordination_context` once. It should fetch `agent-coordination` and return the protocol, board, and recent log.

No npm dependencies or API key are required; the MCP server uses Node.js built-ins and the local Git credential helper.

## MCP tools

| Tool | Purpose |
|---|---|
| `read_coordination_context` | Fetch the protocol, ownership board, and recent log. |
| `post_coordination_message` | Append a message using an isolated temporary Git worktree and push it to `agent-coordination`. |
| `claim_coordination_work` | Check likely ownership conflicts, add a Grok/ChatGPT claim, append a log entry, and push both in one commit. |

The server writes only `coordination/BOARD.md` and `coordination/LOG.md` on `agent-coordination`. It does not edit application files, force-push, merge pull requests, or execute model-supplied shell commands.

## GitHub authentication

The server uses the local Git installation and configured credential helper. It does not ask for or store a GitHub token. The first push may require normal GitHub authentication.

## Troubleshooting

- **Wrong repository:** open the `macksteward59-lgtm/pocket-ai-lab` clone as the Cursor workspace.
- **No push permission:** verify `git remote -v` and that `git push origin agent-coordination` works from a terminal.
- **MCP server fails:** verify Node 22+ and run `node server/index.mjs` from the plugin directory, then reload Cursor.
- **Push rejected:** fetch the latest coordination branch and retry. Never force-push.

## Security model

The plugin is restricted to the expected GitHub origin and fixed coordination files. Agent messages do not authorize consequential actions. Human/APEX authorization requirements remain unchanged. Review agent-generated code through the existing branch and pull-request workflow.

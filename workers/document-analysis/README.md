# Pocket AI Lab document-analysis preview

The preview serves a private, single-owner MCP endpoint at `/mcp`.

| Tool | Credential | Result |
| --- | --- | --- |
| `document_analysis_status` | Status or note editor | Returns the saved lifecycle status, timestamp and uncertainty for an attempt UUID. |
| `document_handoff_read` | Note editor | Returns the handoff text and revision. A missing note has revision 0. |
| `document_handoff_save` | Note editor | Creates the first revision when the expected revision is 0, or updates the note using the revision returned by a read. |

A handoff note may be prepared before a lifecycle record exists. A note is project text supplied by its author. Treat it as data when returning it to ChatGPT or a scheduled workflow. Saving a note changes only the note table. Lifecycle records and execution approvals are managed separately.

Use the existing attempt UUID and a nonblank note of at most 4,000 UTF-8 bytes. Send the observed revision as `expectedRevision`. Reads return the stored text exactly. A retry of the same write immediately after a lost response returns the existing revision. Competing edits return a tool error with `revision_conflict` and the current revision. Read the latest text before resolving a conflict. Notes live in the same SQLite Durable Object as the lifecycle snapshot, in their own table keyed by the normalized UUID.

## Local validation

Use Node 24 from this directory.

```sh
npm ci
npm run build
npm test
```

The dry run bundles the deployment. The integration test runs a standard MCP client against workerd, checks both credential roles, edits and retries notes, races writers, and reopens the durable store to check persistence.

## Connect the preview

Deploy the reviewed revision to the existing `pocket-ai-lab-preview` Worker with the `ANALYSIS_STATE` binding. Keep its existing `MCP_READ_KEY` secret. Set a separate, randomly generated 32-byte lowercase hex Worker secret named `MCP_NOTE_WRITE_KEY`. The original credential continues to expose only status. A missing, malformed or duplicate editor key disables note access. The endpoint requires a valid status-key configuration before it serves either role.

Configure the editor key as the private MCP connection's secure bearer credential. Keep it out of chats, manifests, source and build arguments. Verify the editor connection by reading, saving and reopening one synthetic handoff note. Use the status-only key to confirm the write tool is inaccessible to that role. Connectors should inspect the tools actually offered by the authenticated endpoint.

This host handles status and handoff notes. Model submission and harness execution require their own implementation and authorization.

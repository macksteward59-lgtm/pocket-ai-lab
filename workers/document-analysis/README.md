# Pocket AI Lab document-analysis status

This Worker serves a single-owner MCP endpoint at `/mcp`. Its `document_analysis_status` tool accepts a Pocket AI Lab attempt UUID and returns the last stored lifecycle status, update time and uncertainty flag. An unknown attempt returns `{"found":false}`. A storage or validation failure returns a tool error. Read access requires the Worker secret `MCP_READ_KEY` as an HTTP bearer token.

## Test locally

Use Node 24 and run the following commands in this directory.

```sh
npm ci
npm run build
npm test
```

The build uses Wrangler's dry run. The integration test uses temporary local SQLite storage and Cloudflare's Workers runtime. A fixture coordinator records a document task and rejects a competing stale writer. A new runtime then loads the deployable Worker bundle and a standard MCP client queries the saved status. The test entry point and fixture data are separate from the deployed bundle.

## Connect the preview

Deploy this directory from the reviewed repository revision using Wrangler in the intended Cloudflare account. The target in `wrangler.jsonc` is the existing `pocket-ai-lab-preview` Worker. Deployment replaces its Hello World handler and applies the SQLite Durable Object migration. Use the account's existing free plan and verify the migration and binding before enabling the plugin.

Store a dedicated, randomly generated 32-byte lowercase hex key as the Cloudflare Worker secret `MCP_READ_KEY`. Configure the same value through the private plugin connection's secure bearer credential field. The endpoint returns 503 until the Worker secret is configured. Verify unauthenticated rejection, authenticated MCP initialization, tool discovery and a lookup before binding the live URL to the plugin. Keep the key out of source, transcripts and build arguments.

The Durable Object binding is `ANALYSIS_STATE`. All writers for this owner must use the object named `document-analysis-v1` in that namespace and the existing snapshot adapter. The preview supports status lookup only. A producer for approved analyses still requires independent admission, release, consent and budget checks. Completed lifecycle state describes the stored task. It confers no APEX authorization or evidence verification.

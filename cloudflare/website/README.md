# Pocket AI Lab public web preview

This Worker serves a read-only preview of the interface in `apps/web/`. Visitors can navigate Chat, Agent team, Memory, Activity and Settings. Chat, saved notes and agent execution require the local app.

## Verify a checkout

Use Node.js 24 and Python 3. From `cloudflare/website/` on Linux or macOS, run the following commands.

```sh
npm ci
npm run build
npm run check
npm test
```

The build generates `public/` from the checked-out browser assets. The Wrangler dry run validates the package. The tests start a local Workers runtime and check the public assets, content security policy and private route responses.

## Cloudflare Workers Builds

Configure each service on a branch containing its Wrangler configuration. The private handoff implementation is under review in [PR #245](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/245).

| Setting | Public website | Private handoff |
| --- | --- | --- |
| Worker name | `pocket-ai-lab` | `pocket-ai-lab-preview` |
| Root directory | `cloudflare/website` | `workers/document-analysis` |
| Build command | `npm run build` | `npm run build` |
| Production deploy command, after approval | `npx wrangler deploy` | `npx wrangler deploy` |
| Runtime configuration | Static assets in `public/` | `ANALYSIS_STATE` Durable Object and existing `MCP_READ_KEY` and `MCP_NOTE_WRITE_KEY` secrets |

The website CI runs local checks. Publishing the website and updating the existing private Worker are separate release decisions.

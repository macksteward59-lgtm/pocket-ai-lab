# Look up a Pocket AI Lab source or decision

Open **Project sources** in the local consumer web app (`npm run start:web`). Enter a topic such as “trailing newline” or a stable ID such as `NATIVE-EXACT-ANSWER`. A decision shows the current revision first, followed by the earlier wording and its own evidence link. Here “current” refers to the implementation named in the record, which may be a draft branch.

A local client can read the same results with `GET /api/project-sources?q=W3C-PROV`. The JSON includes the source register commit, matching source IDs and passage locators, or an explicitly linked decision history. An empty result means the register had no lexical match. A search match alone does not verify a claim.

The existing private **Pocket AI Lab Handoff** connection can already read the shared research index (`6f6b446a-c306-5610-9fab-fa8c5777b881`). Follow a decision pointer for its recorded evidence and compare its snapshot with the [canonical GitHub register](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/docs/research/project-sources.json). The local search endpoint runs in the consumer app. The Cloudflare handoff uses its existing revisioned note reader.

The index is built in memory from the bundled public register. Searches do not read owner's notes or contact a provider. Use Node with the built-in SQLite module and FTS5 enabled. To refresh the offline snapshot, copy the canonical JSON byte-for-byte from a reviewed coordination commit, update the commit in `apps/web/project-sources.mjs` and update the checksum test. Keep every previous decision revision, its source, and its explicit successor relationship.

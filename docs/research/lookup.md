# Look up a Pocket AI Lab source or decision

Open **Project sources** in the local consumer web app (`npm run start:web`). Enter a topic such as “trailing newline” or a stable ID such as `NATIVE-EXACT-ANSWER`. A decision shows the current revision first, followed by the earlier wording and its own evidence link. Here “current” refers to the implementation named in the record, which may be a draft branch.

A local client can read the same results with `GET /api/project-sources?q=W3C-PROV`. The JSON includes the source register commit, matching source IDs and passage locators, or an explicitly linked decision history. An empty result means the register had no lexical match. A search match alone does not verify a claim.

The existing private **Pocket AI Lab Handoff** connection can already read the shared research index (`6f6b446a-c306-5610-9fab-fa8c5777b881`). Follow a decision pointer for its recorded evidence and compare its snapshot with the [canonical GitHub register](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/docs/research/project-sources.json). The local search endpoint runs in the consumer app. The Cloudflare handoff uses its existing revisioned note reader.

The index is built in memory from the bundled public register. Searches do not read owner's notes or contact a provider. Use Node with the built-in SQLite module and FTS5 enabled. To refresh the offline snapshot, copy the canonical JSON byte-for-byte from a reviewed coordination commit, update the commit in `apps/web/project-sources.mjs` and update the checksum test. Keep every previous decision revision, its source, and its explicit successor relationship.

## Read the same register in ChatGPT and Cloudflare

In a chat with **Pocket AI Lab Handoff**, read the research index and follow its complete-register pointer. The release for coordination commit `a13f2314652f5243296acf8d8c4d74e0349eda1b` has catalog note `4c04d0f3-934f-8995-92a2-e52e981a31e0`. The catalog lists source IDs, titles, topics and the note UUID for each record. Read the chosen note to obtain the original publisher, URL, passage locator, finding and project use. A decision note contains every recorded revision and its own citations. For example, use `NATIVE-EXACT-ANSWER` to check how a historic score was treated.

A local reviewer can use `node tools/source-handoff/cli.mjs search "trailing newline"` with the existing preview note credential configured in the process environment. The command reads the catalog and each record from the fixed preview endpoint, verifies their text against the bundled GitHub snapshot and searches the reconstructed records with the same index as the consumer app. A missing or changed record stops the search. The offline Project sources screen continues to work with its bundled copy.

## Publish a reviewed update

1. Update the local snapshot and pinned coordination commit as described above. Run `node tools/source-handoff/cli.mjs plan` to inspect the exact public records and catalog.
2. From the authorized owner connection, publish that plan with the existing handoff read/save tools, or run `node tools/source-handoff/cli.mjs publish` in an environment with the preview note credential. Each note is addressed by its contents. The publisher accepts a byte-identical existing note, creates a missing note at revision zero, and stops on a mismatch. It reads new notes back and writes the catalog last. Retrying after interruption reuses verified notes.
3. Read the published catalog, then update the pointer in the existing research index using its observed revision. Older catalogs and records remain addressable. Use `node tools/source-handoff/cli.mjs evaluate` to run the frozen retrieval cases on the published snapshot.

A GitHub push runs repository tests. Publishing the reviewed register is an explicit one-way operation. Reading or saving these Cloudflare notes starts no GitHub job and makes no model inference request. A ranked source is a candidate for review. Check its cited passage before answering a factual question.

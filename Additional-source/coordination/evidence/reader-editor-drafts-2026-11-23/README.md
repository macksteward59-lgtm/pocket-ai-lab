# Resume a browser reader draft offline

[PR #300](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/300) lets the owner save an unfinished single-parent edit or two-parent blend, reopen it in the same browser profile, and publish the finished child after a fresh comparison. [Try the workflow](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/9863916f56530f0bf2670a6b152042aaf68e177d/docs/implementation/unified-model-workflow.md#resume-an-unfinished-reader-edit-or-blend)

| Observed case | Chromium and WebKit |
| --- | --- |
| Two tabs saved identical incomplete JSON | One draft ID. Its raw editor text and original whitespace survived a browser restart. |
| Two drafts had the same displayed name | The picker distinguished the snapshots. The 35% blend reopened with its original parents, selected bias and unapplied text `1e`. |
| Replacing work | Cancel preserved a newly configured 42% blend, and also preserved a buffer after another tab deleted its saved copy. |
| Publishing | Drafts stayed outside the runnable model menus and family exports. After correcting and applying the value, the owner compared all three readers and explicitly saved the candidate. |
| Deletion | The owner could remove a deliberately damaged draft while retaining the other snapshot and all published readers. |
| Offline operation | Both recipients closed the browser process, stopped the app server and reopened the cached app before recovering the editor. |

The test blended the selected readers with 35% from the second parent and added 0.125 to hidden-unit bias 3. The independent calculation reproduced both snapshot IDs from the original text and editor settings, all 97 final weights, their digest `12d0eb1a76cd38f9853b251e84e3357459a602b74ca383575144ad9c4f2143f9` and the build ID `build-82f54ef02eff54e19268a744408b92ad19c5c6d42d02504392fb29156df948b7`. The Python sentence reader independently reproduced the workshop scores on its fixed 16 cases: base 14/16, second parent 15/16, edited child 15/16. The transfer and resume test measures preservation of the models and editor state. These scores describe the specific fixture.

[Chromium receipt](chromium/draft.json) · [WebKit receipt](webkit/draft.json) · [Hosted browser job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45243497829/job/137934077003)

The browser test used two bundled compatible readers. A separate check in Node loaded each archived [four-reader family](../portable-reader-families-2026-11-23/README.md), selected the imported child and its already-trained parent, and saved a new draft with 40% from the second reader. After serializing and restoring each draft, the check increased the output bias (intercept) by 0.125 and made a child with both original build IDs. Each child scored 14/16 on the workshop comparison. Removing the expected parent made the draft fail to restore. The originals kept their recorded weights. [Imported-parent results](imported-parent-results.json)

GitHub tested source `9863916f56530f0bf2670a6b152042aaf68e177d` against main `fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873` with checkout `9a5287bec0323bab4f427052db166d32206db0a8`. Its tree matched the source. The two browser receipts were downloaded from the Actions archive and checked against SHA-256 `9913f55c1f02aaca8cd5c7fd014794b21dc5f45c90304be681bb63257749177a`. The receipts use synthetic inputs. Physical iPhone Air acceptance remains open.

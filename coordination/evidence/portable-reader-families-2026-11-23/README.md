# Try a document-reader family

Both files below are importable examples from [the browser test](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45174488538/job/137692099751) for [PR #300](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/300). Each holds four readers. An imported base and the bundled teacher produced a trained reader. That reader and the same teacher then produced a 65/35 blend named **Family blend**.

| Transfer | Downloadable model | Observed result |
| --- | --- | --- |
| chromium 143.0.7499.4 → webkit 26.0 | [Family JSON](chromium-to-webkit/family.json) | [Test record](chromium-to-webkit/acceptance.json) |
| webkit 26.0 → chromium 143.0.7499.4 | [Family JSON](webkit-to-chromium/family.json) | [Test record](webkit-to-chromium/acceptance.json) |

Open either **Family JSON** link and use GitHub’s **Download raw file** control. In the candidate app, open **Model workshop → This browser → Import model family**, choose the downloaded file, review the four readers, and select **Import family**. **Family blend** is now available under **Use a model** and as a parent for a new build. Choose **Use in Chat** with a question and a short passage. Keep the workshop open online once on each new browser to cache the app shell for offline use. [Complete walkthrough](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/d38a1ed1dac9313c138460077c7504221716776e/docs/implementation/unified-model-workflow.md#move-a-child-and-its-parents-to-another-browser)

Each destination started with a fresh browser profile. The tests checked preview and cancellation, rejected altered weights or parent roles, rolled back a late catalog conflict, and imported overlapping families in two tabs. The bundled teacher already existed. Together the two imports wrote three new readers. A repeat import added zero and recognized all four. After closing the browser and stopping the server, each recipient reopened the app, exported the same file byte for byte, answered a passage question and saved a new child linked to the transferred blend.

A separate case deliberately changed a reported evaluation count and checked that the preview showed the file and local values, the new record kept the local measurement, and an existing local alias and its records survived a repeat import. The file identifies its declared training history. Its author and historical training process are unverified.

### How the children scored

The Python reference verified all 97 blend parameters in each file and replayed the app’s held-out scores. On the same 16 questions from four other short documents, the starting base scored **11/16**, the shared teacher **14/16**, the trained parent **12/16** and the 65/35 blend **12/16**. Both files gave these results. The browser reader and Python agreed on all 128 individual choices across the two families. These small fixed sets document the behavior of these specific weights. [Scores and selections](reference-scores.json)

To reproduce with Python 3, check out the PR source at `d38a1ed1dac9313c138460077c7504221716776e` alongside this coordination checkout. Run `python verify_examples.py --workshop /path/to/pr-checkout` from this evidence folder and compare the JSON output with `reference-scores.json`. The script uses the existing Python reader and checks the hash of the additional questions. [Verification script](verify_examples.py)

GitHub tested source `d38a1ed1dac9313c138460077c7504221716776e` against main `fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873` using checkout `cfc5c3fd916b18079d983b11f20f1d97dfafdeea`. The checkout and source had the same tree. The downloaded workflow archive had SHA-256 `2f250be8e3144441fbe9df0a98610156adfcacad3d8a372c883bc41701d43710`. The four archived files were compared with the receipts, then both families were imported with the published verifier in Node, checking every model identity, weight hash, parent link and the pinned evaluation and training sets. The receipts cover mobile browser engines on hosted runners. Physical iPhone and native checkpoint transfer require separate evidence.

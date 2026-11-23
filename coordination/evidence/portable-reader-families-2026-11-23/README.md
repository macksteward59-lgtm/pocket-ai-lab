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

### Compare the child and its parents in the app

At [PR #300](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/300) source `d74e589cc403d1affb7605388ffb7fe35db68039`, import one of the families above, select **Family blend** and use **Compare with parents** for a typed question. For a scored comparison, download the [16-question example](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/d74e589cc403d1affb7605388ffb7fe35db68039/apps/web/model-workshop/comparison-example.json) and open it through **Compare a labeled question set**. Choose “How many grams does a nickel weigh?” to inspect the disagreement. The child and its trained parent abstain. Their second parent selects the first source sentence, “The listed mass of a United States nickel is 5.000 grams.” Use that row’s **Use in Chat** button to open its original passage and question with the chosen model. [Workshop walkthrough](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/d74e589cc403d1affb7605388ffb7fe35db68039/docs/implementation/unified-model-workflow.md#compare-the-saved-child-and-its-parents-on-your-own-examples)

| Reader | Correct on the 16 examples | Answer for the nickel’s mass |
| --- | ---: | --- |
| Family blend | 12 | Insufficient evidence |
| Family trained parent | 12 | Insufficient evidence |
| Hard-label reader, second parent | 14 | Source sentence 1 |

[Chromium](comparison/chromium/comparison.json) and [WebKit](comparison/webkit/comparison.json) ran this workflow on a 390 × 844 viewport. Each also scored a separate two-question test file supplied to the browser. Closing and reopening with the server stopped cleared the prior comparison. Loading the file again worked offline. Canceling a draft replacement preserved the current reader, question and source. Selecting the second parent opened its question in Chat. An explicit Send produced the expected sentence and its Memory draft identified that parent’s exact ID. The test observed zero unexpected HTTP requests, zero automatically sent messages, and an unchanged reader catalog. The 16 public examples are a fixed comparison set. A different passage or question can change which reader gives the best answer.

The [browser job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45199897161/job/137780257856) ran on checkout `5302772456e90a62c5fdaae76c69adb1f1eb5c2c`, with source `d74e589cc403d1affb7605388ffb7fe35db68039` and base `fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873`. The source and checkout trees matched. The two receipts came from the workflow archive with SHA-256 `45d96a993f8ada6e7974105db701085fb73cd66792de06c5503a74b868ba9e32`. Separately, the comparison module loaded the two archived families and matched the existing Python reference on all 96 sentence choices (three participants × 16 questions × two families). The receipts identify the public nickel example. The private-file checks used synthetic inputs.

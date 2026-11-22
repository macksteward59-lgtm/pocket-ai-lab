# A reviewed source answer after the app has fully closed

This review tests a request from the owner's project conversations. Pocket AI Lab should let the owner teach it a correction, quit the app completely and return later to the corrected answer and its source. [Draft #262](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/262) contains the product changes at `12d511f2ae6938a84f65c1d0f31124441bdfeb5d`. The candidate includes #260, #261 and main at `fb59f76`. The cross-project inventory captured the immediately preceding commit `b0bee1a9`. The follow-up changed the native review, its test and the Apple diagnostic log retention.

## What the two models actually answered

The source question was “At what time does the daily free neuron allocation reset?” Both Linux models used the project’s SQLite source lookup and an HTTP model server. Each received the question and retrieved public passages. Neither received the other's reply.

| Evidence | Response text | Cited source |
| --- | --- | --- |
| [Original 1.5B reply](original-answer.json) | The free allocation is 10,000 neurons per day, | CF-QUOTA |
| [Independent 3B reply](independent-answer.json) | 00:00 UTC | CF-QUOTA |

The first model retrieved the right passage and quoted the quantity instead of the reset time. The second returned the reset time given in the [published Cloudflare documentation](https://developers.cloudflare.com/workers-ai/platform/pricing/). The [fresh hosted 1.5B run](hosted-source-check.json) reproduced the wrong fact on this question and answered two of five frozen questions exactly. The reviewed correction applies to this one question.

## Project coverage

- The [repository checks](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44995881798), [consumer checks](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44995884885) and [Linux model workflow](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44995884933) passed on this candidate. The consumer runner recorded 46 web/connector tests, 355 intelligence tests, 160 runtime tests passed with one skipped, four Chromium/WebKit checks, and a Worker persistence test across restarts. Related local nonexecuting governance checks passed 46 tests.
- Covered the project from the original brief through publication, inference, owner correction, persistence and release criteria. The [14-gate review](project-gates.md), [full branch inventory](project-inventory.json) and [exact-head PR workflow survey](pr-workflows.json) describe both existing proof and missing observations.
- The repository contains the code and public test evidence. The private Cloudflare connection holds a revisioned coordination note. Linux hosted the two model calls. A hosted Workers AI inference and its actual account usage still need verification.


## Native failure reproduced and corrected

On the [first Apple run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44993171743/job/137118565079), 77 app unit tests passed. After saving the correction, the UI test swiped down six times trying to read a noninteractive label in a dismissible sheet and failed before termination. The app now shows the saved revision after the vault write, explicitly dismisses the keyboard, and presents a full-screen review with a Done button. The test waits for this confirmation before terminating the process. Subsequent assertions still require the original, correction, source, stable record and exported file.

After the dated 141-PR inventory, [draft #265](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/265) aligned the JavaScript and Python length limits for Unicode questions. Its [repository CI](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44993491241) passed. A separate local combination of #263, #264 and #265 passed 18 offline-reader tests, five CLI tests and the SQLite Unicode regression. Those three drafts remain separate from the published kit.

## Owner recovery and independent readback

An iOS UI test opened the archived server reply through the app's normal importer, entered the corrected excerpt, fully terminated Pocket AI Lab, verified the process was no longer running, and launched it again. The test typed the original question and used **Read saved answer**. It checked the corrected text and source, inspected the original and repeated the import. The native list still contained one record with the same ID. Finally it selected **Save review in Files**. A separate CI step read the file from the installed app's data container and checked it against the 64-character digest the UI displayed.

- The [export](review.json) and [offline readback](readback.json) agree with the original model packet and independent 3B answer. Review SHA-256 is `969546b99998ac20c171911ed7c6c8f7cb28d75903fbe1cadd462f8337ae96f5`. The reader extracted from the distributed device kit also rejected a wrong digest, modified payload, a recomputed digest around an unsupported excerpt, and a different server reply.
- The [Apple runner](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44995884905/job/137126696854) built for the simulator and generic arm64 device, rebuilt a fresh extraction of the kit, ran the native app tests, and checked the encrypted vault header. The [machine-readable outcomes](acceptance.json) retain counts, skips and benchmark failures. The simulator imported a real server reply. This test did not originate the answer from a handset model.
- The [kit identity](kit.json) records both archive hashes, the GitHub artifact and the source-commit tree. The kit is unsigned. The simulator's export and its independent hash are also available as a [GitHub Actions artifact](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44995884905/artifacts/14744487028).
- The live Cloudflare note `b4d749ad-234f-50a4-9f6c-4e27a3a97bbe` accepted the correction at revision 2. Repeating the identical save with the earlier expected revision returned 2. A fresh read returned the same text at revision 2. The phone export was transferred as public test evidence by ChatGPT. Cloudflare hosted the note.
- The first unobserved device step is offline model generation on a signed physical iPhone Air. A generic arm64 build, simulator run and device file digest cannot attest to signing, installation, on-device execution, or hardware measurements. The separate frozen macOS model quality gate remains open.

To reproduce the independent check from the extracted kit, copy the export and its separately held digest and run:

```sh
python3 tools/evaluation-review/source_review.py review.json --expected-digest "$review_hash" --original ios/PocketAILab/SourceAnswerExample.json
```

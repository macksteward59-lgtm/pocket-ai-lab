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

## Signed iPhone Air source-review run

The unsigned #269 kit contains the generated Xcode project and six iOS arm64 frameworks. On November 22 a fresh Linux download matched GitHub's SHA-256 for both the kit and the simulator export. The inner tarball matched its checksum and identified source checkout `742f04e31b39a9b30d20181a6c9eaf71e63bbd24` (PR head `e53d7be0c8aac9b8515f834e6f40c58c3cf534cd`). The bundled reader verified the original imported reply, the saved `00:00 UTC` correction, and the independently recorded export digest. It rejected a wrong supplied digest and an unsupported replacement excerpt even when the replacement's digest was recalculated. This confirms the download and Linux review path for the simulator export. The physical run requires the owner's paired iPhone Air and a Mac with Xcode. [Kit](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45031228658/artifacts/14758936566) · [Simulator export](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45031228658/artifacts/14759087783)

1. On the Mac, open the kit ZIP and run `shasum -a 256 -c pocket-ai-lab-device-kit.sha256` beside its tarball. Extract it, open `PocketAILab/ios/PocketAILab.xcodeproj`, select the paired iPhone Air, select your Personal Team under **Signing & Capabilities**, and run the app from Xcode. The artifact is scheduled to expire November 29 at 9:35 a.m. ET.
2. In **Local AI**, import and load the pinned Qwen2.5-1.5B-Instruct Q4_K_M GGUF. Its SHA-256 is `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`. Turn off Wi-Fi and cellular data before generation. [Pinned model download](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf?download=true)
3. In **Memory → Source answers**, select **CF-QUOTA** and ask “How many neurons are in the published daily free allocation?” Use **Ask loaded model** for a question with no saved answer. Record the request ID and original excerpt. The bundled passage says **10,000 neurons per day**. Save a correction with an exact excerpt if the draft needs one. If the app reports an error, preserve the error and the model and device details.
4. Choose **Save review in Files** and copy the displayed SHA-256 separately. Fully quit the app. Relaunch while offline, find the question with **Read saved answer**, and check the same request ID, cited passage and saved revision. Save the review again and compare its digest with the one copied before quitting.
5. Retain the raw review JSON, independently copied SHA-256, device model, iOS version, kit commit, pre-quit request ID and observed offline/relaunch result. Use the reader from the extracted kit.

```bash
python3 tools/evaluation-review/source_review.py review.json --expected-digest "$review_hash"
```

The review should identify `origin: localRuntime` and source `CF-QUOTA`. Independently compare the original and reviewed excerpts with the requested fact and compare the model hash in the raw draft with the pin. Direct observation supplies the device, network and restart evidence. The signed run and its actual model result are pending.

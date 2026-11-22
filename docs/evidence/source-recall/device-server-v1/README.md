# Device and server passage checks

The project can send a fixed evaluation through the private Cloudflare handoff, run it on a Linux model server, and recover its result through ChatGPT. Draft [#258](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/258) adds the same six questions to the native app. Draft [#259](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/259) compares models and checks six exported native attempts against a separately recorded server result. The phone still needs its first physical run.

## Common device and server questions

The [six shared questions](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/1cba9524ddcee6244fab5591c1b36fb344053adc/ios/PocketAILab/PassageChecks.json) were committed before observing model outputs. Four ask for a short, exact answer with a supporting passage label. Two require UNKNOWN because the passages omit the requested fact. All named account balances in the questions are synthetic.

| Execution | Exact answers | Evidence |
| --- | ---: | --- |
| Local CPU model server | 4/6 | [Raw replies](local-linux.json) |
| GitHub-hosted CPU model server | 3/6 | [Raw replies](hosted-linux.json) and [completed job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44981550177/job/137082918687) |
| Work order read from Cloudflare, executed on local CPU, written back and verified | 4/6 | [Raw replies](cloud-work-order-linux.json) |

Both Linux environments used Qwen2.5-1.5B Instruct Q4_K_M with identical model and suite digests. All three runs correctly declined the two questions with missing evidence. Neither raw model supplied both required citations on the two synthetic-balance questions. The hosted model also missed the exact reset time. Identical weights, prompts and seed did not produce identical answers across hosts.

## Model and decoding comparison

Each environment below made 54 authenticated loopback HTTP requests, three decoding modes on 18 questions. The first six are shared with the phone. [Six similar-record questions](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/06cb003995875c2477805a1e3edd16646ed777b4/tools/passage-check/HeldOut.json) exposed errors in initial output. [Six more questions](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/ca83ea0d7e582b4701efb27218f7e5a2588f41dc/tools/passage-check/Transfer.json) were committed before trying quoted-span decoding. The team wrote and scored the cases. Model-size selection occurred after observing the 1.5B results, so the 3B comparison is exploratory. The trials used public-document excerpts and synthetic passages supplied directly in the prompt. End-to-end search and free-form synthesis require additional tests.

| Execution | Decoding | Exact answer | Expected value in reply with correct final label | Exact UNKNOWN when unsupported |
| --- | --- | ---: | ---: | ---: |
| [Local Linux, Qwen2.5 1.5B](local-1b-comparison.json) | unrestricted | 8/18 | 3/12 | 5/6 |
| [Local Linux, Qwen2.5 1.5B](local-1b-comparison.json) | citation-grammar | 9/18 | 11/12 | 6/6 |
| [Local Linux, Qwen2.5 1.5B](local-1b-comparison.json) | quoted-span | 9/18 | 11/12 | 6/6 |
| [GitHub Linux, Qwen2.5 1.5B](hosted-1b-comparison.json) | unrestricted | 7/18 | 2/12 | 5/6 |
| [GitHub Linux, Qwen2.5 1.5B](hosted-1b-comparison.json) | citation-grammar | 9/18 | 12/12 | 6/6 |
| [GitHub Linux, Qwen2.5 1.5B](hosted-1b-comparison.json) | quoted-span | 9/18 | 12/12 | 6/6 |
| [Local Linux, Qwen2.5 3B](local-3b-comparison.json) | unrestricted | 6/18 | 6/12 | 0/6 |
| [Local Linux, Qwen2.5 3B](local-3b-comparison.json) | citation-grammar | 7/18 | 7/12 | 0/6 |
| [Local Linux, Qwen2.5 3B](local-3b-comparison.json) | quoted-span | 13/18 | 7/12 | 6/6 |

Each linked JSON retains the original server reply, finish reason, model, suite fingerprint and prompt digest. The shorter exact answer and source label determine the strict grade. The secondary label check also counts longer responses containing the value. It cannot establish whether every other word in the response is true. A quoted span can still come from the wrong passage or answer a different question.

The [54-request hosted workflow](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44982563848) passed its completeness checks. For reproduction, the original ZIP SHA-256 is `856c988b2fe987b874ad0f5ea11934b03a657deda4457f455ae93ee38a4d9d42`. The model, runtime and case pins and commands are in the [comparison guide](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/4f38f303aa0de9ea5a315c2e9b6bdb987ea5fe95/tools/passage-check/README.md).

## Live Cloudflare round trip

The private handoff note `95af5a98-c661-5004-8edf-5df8965db318` was absent at revision 0. ChatGPT saved the fixed work order at revision 1 and read back its action name, case count and exact suite digest before starting the local server. After all six requests completed, the guarded write advanced to revision 2. A separate read matched the result text exactly, including the original case outputs and the raw result SHA-256 `af43bfc06e3b2348915ab822e4e519d00b6b5973e7b33c3bced0989420ab80bd`. This run was supervised by ChatGPT. No background subscriber or Workers AI model invocation was involved. PR changes to the passage runner start the hosted evaluation. A handoff-note write has no GitHub or deployment trigger in this test.

The default project note at revision 6 links to the integrated prototype note at revision 6. That note links to native engineering note `95ac3529-1963-5039-b1a9-1627a2c46695`, read back exactly at revision 5 after adding these results. A later project chat can follow the same path.

## Physical iPhone Air acceptance

Compare the native app first with the unmodified six-question 1.5B server run. Import the [pinned Qwen2.5-1.5B Q4_K_M model](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/blob/91cad51170dc346986eccefdc2dd33a9da36ead9/qwen2.5-1.5b-instruct-q4_k_m.gguf). Its SHA-256 is `6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e`. In Local AI, run **Check source evidence** offline. Retain the six event digests separately, close and reopen the app and export the attempts. The [comparison command](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/4f38f303aa0de9ea5a315c2e9b6bdb987ea5fe95/tools/passage-check/README.md#compare-an-iphone-run-with-the-hosted-reference) checks each event and the server digest, rejects mixed model sessions and reports both scores. A smoke test using six explicitly synthetic events and the real hosted report correctly scored zero observed native passes and three server passes. Hardware identity and environmental measurements require actual device observation. Keep personal model input and physical exports private.


## Hosted Apple gates

The Apple runner built the app for arm64 iOS and the simulator, rebuilt the extracted test kit for a generic iOS device, and passed the native app XCTest suite on a simulator. The separate frozen macOS recipient benchmark produced zero valid answers in 36 attempts and its independent check failed. [Device test kit artifact](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44981550178/artifacts/14738847528) and [verified package identities](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/docs/evidence/source-recall/device-server-v1/device-kit.json). The kit is unsigned. Its PR test-merge tree matches feature head `7fc3b96` exactly.

The final [Apple job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44981550178/job/137083021356) reports 75 app unit tests and one UI test with zero failures. The app test that uses a catalog-selected model lease and reopens all six passage events passed with its test provider. The simulator runtime suite reported 154 tests, five skipped and zero failures. The installed Memory vault header check passed. The only failed steps were the original macOS recipient benchmark and its independent verifier.

Feature heads under review are `7fc3b96` for #258, `4f38f30` for #259 and `2083972` for #260. The main branch was observed at `fb59f76`. The PR stack is the build source for this evidence.

## From a question to a retrieved passage

In [draft #260](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/260), an ordinary question reaches the actual consumer app SQLite index, then the local model server. The model chooses an excerpt from at most two reviewed public summaries or returns UNKNOWN. Each proposed quote is checked against the cited record and includes its source ID and original URL. All five [graded questions](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/dfdfbd8ca3a83265af4e9736ce24913e9ac3352d/tools/source-answers/questions.json) were committed before inference.

| Run | Exact answer and source | Correct source ID on answerable questions | Correctly abstained | Strict misses |
| --- | ---: | ---: | ---: | --- |
| [Local 1.5B](lookup-local-1b.json) | 2/5 | 3/3 | 2/2 | reset, provision, allocation |
| [GitHub 1.5B](lookup-hosted-1b.json) | 2/5 | 3/3 | 2/2 | reset, provision, allocation |
| [Local 3B](lookup-local-3b.json) | 3/5 | 3/3 | 2/2 | provision, allocation |

An answer can cite the correct source while selecting the wrong fact. For example, the user question about the reset time yielded a quote about the size of the allocation in the local 1.5B study. Returned quotes require review. The 3B run returned the exact reset time and correctly declined both unknowns. Its remaining two quotes contain the requested fact with extra wording. The reference [hosted job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44983148242) also exercised the model comparison after factoring out the shared local-server lifecycle.

# Pocket AI Lab research memory

The owner wants to give one research objective from iPhone Air and recover the evidence, draft, independent review and any correction under the same task after interruption. The project uses its GitHub coordination branch for the research record and its existing private ChatGPT handoff for recall across sessions. This page records the November 21, 2026 research pass.

## Look up a finding

Read the [source register](project-sources.json) for the publisher, URL, passage locator, retrieval date, finding and application to Pocket AI Lab. In a new project chat with Pocket AI Lab Handoff connected, ask it to read research note `6f6b446a-c306-5610-9fab-fa8c5777b881`. The default project note points to the engineering note, which points here. The research note includes the eight findings and their URLs; it can answer a source lookup without searching the web again. A new search is appropriate before relying on a changing price or account condition.

| Question | Entries to retrieve | Consequence for the prototype |
| --- | --- | --- |
| Can a free Apple account test a native build on this phone? | APPLE-TEAM, APPLE-DEVICE | Apple documents personal-device testing through Xcode on a paired Mac. A Personal Team profile lasts seven days. The device test still needs access to the physical iPhone Air. Record the build, model identity, output and what survives an interruption. |
| What proves Cloudflare ran a model and what counts against the free tier? | CF-BIND, CF-QUOTA | A successful AI binding invocation identifies a model and returns its result. The existing note read/write confirms a different service. Cloudflare lists 10,000 free neurons per day, reset at 00:00 UTC. Consult current plan and usage before spending any allocation. |
| How does a later chat check or correct a claim? | W3C-PROV, W3C-QUOTE | Open the recorded source and section, check whether it supports the claim, then record a dated correction with a reference to the earlier version. Where passages repeat, use surrounding text to identify the right passage. Preserve the distinction between a publisher claim, a project decision and an observed result. |
| What should the lab do when evidence is incomplete? | ACL-CITE, ACL-ABSTAIN | Grade answer correctness, source support and appropriate abstention independently. Preserve failed examples. A model can look cautious while declining questions the evidence answers. |

## What the experiment found

The [frozen source study](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/252) used the immutable [eight-source corpus](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/996d8ed1fc600e828f996ca59b506816e7a52c55/docs/research/project-sources.json). Each question had two supplied excerpts. The same question was repeated with the supporting excerpt withheld. A real Qwen2.5-1.5B-Instruct Q4_K_M model ran using llama.cpp b12233 on Linux CPU. The answer grammar admitted a choice with its source number or an explicit insufficient-evidence response.

| Measure | Observed |
| --- | ---: |
| Valid responses | 12/12 |
| Correct option and supporting excerpt when present | 2/6 |
| Correct abstention when the supporting excerpt was absent | 6/6 |
| Answered without evidence | 0/6 |
| Correct on both versions of a question | 2/6 |

The model answered the W3C passage-location and ALCE evaluation questions. On Personal Team profile expiry, the Workers AI quota unit, model invocation inputs and provenance relationships, it abstained even with the answer present. The predeclared 5/6 threshold for paired success was missed. Source summaries, language and distractors limit any inference about broader research ability. The excerpts were supplied directly to the model. This run did not evaluate open-web retrieval or long-form generation.

The [GitHub Actions run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44951741022) and a separate Linux run produced identical bytes for all 12 records. [Original Actions evidence](../evidence/source-recall/44951741022/artifact.zip.base64) is base64-encoded ZIP data. Decode it to read the raw questions, sources and replies. The decoded archive SHA-256 is `2a6816b5dfd7f2b7fa4c307695ddd2c815f73368e915e7dc58f439d517b6d108`. Both trials files hash to `dc665740402d6007c9bc1a093e4387981c75f6b6a522817e9b42666c2eec1903`.

## Engineering decision

Keep direct lookup by source ID available to the owner and reviewer. Use the saved passages when checking a proposed answer; this model has yet to qualify as the sole reviewer for sourced answers. The next model comparison should use previously unseen questions and sources with citations and missing-evidence cases frozen before scoring. Device qualification still requires a physical-device run. Hosted inference still requires an attributable Workers AI response. The two provider checks can use the same read-only source question and remain separately attributable.

### Experimental models and reusable source code

The [November 21 donor review](experimental-model-donors-20261121.md) includes release pins and licenses, a 24-claim groundedness pilot, an eight-record IBM text-format round trip, a keyword retrieval baseline, and three publisher YouTube videos. Use this record alongside the original evidence register when a later chat asks which specialized model or upstream component has actually been tested.

## Search the register and recover a corrected decision

[Draft #256](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/256) adds **Project sources** in the local consumer app. Search for `trailing newline` or `NATIVE-EXACT-ANSWER`. The first version accepted surrounding whitespace. The revised version requires exact UTF-8 output. Both rules cite their own implementation. Earlier results keep their original version and score. See the [pinned public register](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/a13f2314652f5243296acf8d8c4d74e0349eda1b/docs/research/project-sources.json) and [local app instructions](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/35a340aba8dbe4aaa85f5036f1a1da96bfb89a66/docs/research/lookup.md).

The intended reference ranked first on all six previously used development questions. The earlier keyword baseline placed the provenance source fourth. The [recorded rankings](../evidence/donor-model-review/consumer-lookup-ranks.json) cover a small, known question set. Unseen questions and screenshot retrieval remain unevaluated.

A reviewer starting in a fresh agent session read the default Pocket AI Lab Handoff, followed the research index `6f6b446a-c306-5610-9fab-fa8c5777b881` at revision 4 to decision note `f663e9f6-c6ed-5cd3-ab37-573a36cd0e19` at revision 1, then checked both pinned implementations. The reviewer correctly recovered that an earlier passing score of 1.0 is retained and a new response with an extra newline scores 0.0 under suite 1.1.0. Cloudflare provides the shared note. SQLite search runs in the local consumer app.

At feature head `19a69da59edeb091668ea77ebb16403471cb3d6d`, the [consumer job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44975548218/job/137064518451) passed the repository test suite, TypeScript build, and project-source UI tests in Chromium and WebKit at 393 × 852. Each browser verified the current and previous versions and their respective citations, an exact source ID, and an empty result. [General CI](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44975544169) also passed. These were browser tests on a hosted Linux runner.

## Full register in the private Cloudflare handoff

[Draft #257](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/257) connects the pinned register from #256 to the existing note service. The private ChatGPT connection published eight full source records, one versioned decision and their catalog. A repeat publication created zero notes. A separate read through the same connection restored all nine records and checked their text against the reviewed snapshot. The previous hand-curated research index is now at revision 6 and links directly to catalog `4c04d0f3-934f-8995-92a2-e52e981a31e0`. Select a candidate by title or topic in that catalog, then use its note UUID to read the full record. SQLite ranking ran locally on the actual returned bytes. A ChatGPT app with the two handoff tools can read the catalog and follow individual records.

The [twelve new questions](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/0f9f7107b08f92482589f77e093ca90eb132861d/tools/source-handoff/recall-cases.json) were written after the search implementation was frozen and committed before their results were observed. The same team wrote and scored them. Of nine questions with a designated supporting source, seven ranked it first and all nine returned it within five. The allowance-reset question placed the right reference third and the missing-evidence study placed fifth. All three questions about facts missing from the register returned topical suggestions. No model answered these cases. [All returned IDs and ranks](../evidence/source-recall/register-handoff/recall-results.json)

The consumer UI now labels these as suggested sources and asks the reader to check the cited passage. A next evaluation should score whether an answer is supported by its passage and whether the system abstains when only an external observation could resolve the question. Current account usage, physical iPhone Air behavior and acceptance of hosted inference each require their own observation.

At feature commit `0944346e4af5d1123c63b9990cc3881d18becfe5`, the [consumer CI job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44976675125/job/137068008587) passed the repository tests, TypeScript build, Chromium and WebKit phone-width tests, and the Cloudflare Worker runtime test. The CLI transport sent MCP requests to a real local Worker runtime with fixture credentials. After restarting the runtime, the entire published register was recovered byte-for-byte at the note level and compared field-for-field to the original document. [General CI](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44976646011) also passed. Live note storage was verified separately with the owner-private ChatGPT connection.


## Answering from passages on a model server and iPhone

The [device and server evidence record](../evidence/source-recall/device-server-v1/README.md) extends the search study to questions whose passages are actually supplied to the model. It records a Cloudflare work order executed on a Linux model server, two Linux hosts, a second model, missing-evidence and near-match questions, and the test required to compare the six native exports. Keep retrieval quality, answering quality and hardware acceptance as distinct results.

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

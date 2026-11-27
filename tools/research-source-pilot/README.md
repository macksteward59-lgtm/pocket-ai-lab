# Research source pilot

This local candidate turns three selected research sources into inspectable cards and a reproducible evaluation of Pocket AI Lab's existing compact document readers. It advances the first bounded parts of W01 and W03. The exported question set uses the current workshop's existing comparison format.

## What is included

- Three primary-source cards: **The Alien Space of Science v3** and its nine authors; **PHANTOM-B** by Adam Shostack; and **ChatMate** by Ori Lahav. A fourth card contains explicitly owned synthetic controls.
- Sixteen source notes with author, version, source family, primary URL, page or section locator, claim type, provenance and limitations.
- Twenty-four frozen visible development questions: fourteen supported selections and ten selector-abstention cases, including a conflict and an instruction embedded in untrusted text.
- A Node runner that calls the unchanged `compareReaders` entry point and both unchanged bundled 97-parameter v1 readers.
- An independent Python verifier that checks the frozen files, model identities, numerical decisions, citation bindings and metrics without importing or executing the JavaScript evaluator.

The original sources, videos and full PDF are not bundled. The short notes are original paraphrases. Their digests identify the notes and their metadata, not the upstream PDF or current web page. Published-source statements remain author reports; they are not Pocket execution evidence. No source, prompt or returned text is executed as a tool instruction.

## Exact baseline

Repository: [macksteward59-lgtm/pocket-ai-lab](https://github.com/macksteward59-lgtm/pocket-ai-lab).

Review dependency: [draft PR #300](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/300), source revision `4d4baafeeaca5eaa409b2505c910dabcb5700a3e`. The accepted main baseline was `bd734e97f6813cd12d8689949539889df2b8eb70`; the workshop dependency remains unmerged. `baseline.json` pins ten existing files with both Git blob IDs and SHA-256 digests. The portable package contains an exact subset of that revision, not a full repository checkout. No existing application files are changed.

Local candidate branch: `codex/research-source-pilot-20261127`. The repository overlay adds only `tools/research-source-pilot/**`. No remote branch or pull request has been created for this candidate. Apply only against the named dependency, or reconcile it against the current accepted workshop before publishing.

The source-evidence adapter was inspected read-only. Its static-code observation format is not a paper-answer format, so it was not repurposed to imply vulnerability confirmation. APEX, East, task recovery, native inference and the active workshop lane remain separate integration dependencies.

## Run and verify

Use **Node 24** and **Python 3.10 or newer**. No package installation, model download, network access, paid inference or training is required. Run these commands from the repository/package root:

```bash
node tools/research-source-pilot/evaluate.mjs \
  1ce55de2ac1227914b99335f124fa874afe7ef6591b71a917f51f137a6ff9d06 \
  evidence/research-source-pilot
```

The runner verifies the frozen corpus, labels and baseline module bytes before loading the baseline implementation. It writes the per-case report, a compatible workshop question file, a report digest and descriptive environment metadata. The existing package's missing ESM declaration can cause Node's harmless module-type warning; this candidate does not change the package configuration to suppress it.

Run the independent verifier:

```bash
python3 tools/research-source-pilot/verify.py \
  1ce55de2ac1227914b99335f124fa874afe7ef6591b71a917f51f137a6ff9d06 \
  evidence/research-source-pilot/report.json
```

Keep the freeze digest separately from an untrusted replacement package. A digest is an integrity check, not an author signature, approval receipt, execution attestation or proof that the underlying publication is true. The local checkout must remain stable during evaluation; this runner is not a hostile-filesystem sandbox and does not close the project's separate confined-reader work.

Regression commands:

```bash
node --test tools/research-source-pilot/test.mjs
python3 tools/research-source-pilot/test-verifier.py
```

The Node cases cover label-independent predictions, family and ID split overlap, malformed input, source/version/author binding, changed-code preflight, exact replay and workshop import compatibility. The Python regressions cover independent mathematical reference cases and altered reports or frozen inputs.

## Observed development result

Executed locally on Linux with Node 24.22.3 and Python 3.12.14. The frozen cases were written before the first run; weights and labels were not tuned after inspecting the scores.

The 12 Node regressions and 26 independent Python regressions passed. The separate Python process reproduced all 48 decisions and verified 21 returned-note citations. Its maximum probability difference was approximately `5.6e-17`, below the `1e-12` comparison tolerance.

| Unchanged reader | Correct supported selection | Protocol abstention | Bound returned-note citations |
|---|---:|---:|---:|
| `soft` | 9 / 14 | 10 / 10 | 9 / 9 |
| `hard` | 10 / 14 | 8 / 10 | 12 / 12 |

Both readers abstained on the bibliographic-list question, the paired temporal-enrichment question, PHANTOM-B's excluded coverage, and the definition of RPE. The soft reader also abstained on the main-generation setting. These are supported questions for which the expected note was available.

The hard reader selected the conflicting-report note for F03 and the untrusted instruction for F05. Both selections were bound correctly to their source notes. This demonstrates why technical citation binding is a separate measure from the requested answer and from authority to act. No tool operation, account access or export was attempted.

F03 requires special care in interpretation: the returned note itself says the reports conflict. A future answer composer could use that note to explain uncertainty correctly. This narrow selector protocol instead requires abstention. Likewise, a refusal that cites the paper's availability-model limitation could be a valid semantic answer to A09 even though this selector protocol expects no selected answer. The benchmark does not grade free-form explanations, entailment or the general safety of an instruction model.

The stable report SHA-256 is `c7ec4680f11148f0da096111e6c6325c5db68ee2c7b93eb695fef3eda55fcb4b`. Repeated runs produce the same report bytes; timestamped environment records are intentionally separate.

## Use the question file in the existing workflow

`evidence/research-source-pilot/workshop-comparison.json` has exactly the existing `id`, `url`, `sentences` and `[question, expected_index]` fields. In a compatible existing #300 workshop, use **Model workshop → This browser → Use a model → Compare with parents**, then open this local JSON set. Existing source notes and answer indexes are carried without a new interface.

This continuation executed the actual comparison module and round-tripped the export in Node. It did not perform a new visual browser, signed-recovery, full repository CI or physical-device acceptance run. A source card is not yet a durable account-owned review task. Correction, restart, signed export and independent task-level verification remain W02/W09 work.

## What is frozen and what is still open

All derivatives of a declared source family must share one split. The validator rejects a family in training and evaluation, and rejects a reused source ID even if its family label changes. The current training list is empty. This is declared-identity validation; it cannot discover every unknown paraphrase or mislabeled source family. The previous training corpora of the bundled readers were not exhaustively audited for overlap.

These visible, authored questions are a small development regression set. Independent researcher review and a second numerical verifier strengthen traceability; they do not make the examples a blinded, untouched test set. The original compound paper questions remain useful for a later answer-composition evaluation, where all required facts and caveats must be checked independently.

The source notes are **evaluation material**, not newly admitted training data. Continue W02 by distinguishing an answer, an uncertainty explanation and an untrusted instruction while preserving source identity. Create a separate, family-disjoint collection before adaptation or promotion. Reuse the existing model workshop, keep both parent models selectable and compare every candidate on identical new inputs. No model promotion or model-training result is established by this pilot.

## Source references

- [The Alien Space of Science, arXiv:2603.01092v3](https://arxiv.org/abs/2603.01092v3), revised October 21, 2026. Author order and locators are preserved in `sources.json`. Main-corpus, human-rating and temporal-study quantities remain distinct.
- [PHANTOM-B: A STRIDE Analog for LLMs](https://shostack.org/files/papers/PHANTOM-B_Whitepaper_Shostack.pdf), Adam Shostack, version 1.0, 2026. Its items serve threat elicitation; the card records its scope limits.
- [Breaking the M365 Copilot Sandbox with ChatMate](https://zerolabs.rubrik.com/blog/breaking-m365-copilot-sandbox-chatmate), Ori Lahav, August 6, 2026. The card preserves the recording caveat and the reported tenant-isolation result.

## Publication and integration scope

The owner authorized publication of this bounded candidate and its automatic preview/build attempts. The [coordination claim](https://github.com/macksteward59-lgtm/pocket-ai-lab/commit/bd20ff50d4a304980839d20dcae11c597c80e8c1) precedes the application overlay. The directory is scoped to a stacked draft against the unchanged #300 workshop dependency; merge, production deployment and physical-device acceptance remain separate.

Future app integration follows the [confirmed conversational workspace requirements](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/coordination/POCKET_AI_LAB_CONVERSATIONAL_WORKSPACE_2026-11-27.md): one front assistant uses the existing harness, projects and individual chats are navigable in the sidebar, and both user and assistant can create tools, agents and teams. This pilot provides source/evaluation fixtures for that journey; it does not implement the new workspace UI or resource-creation workflow.

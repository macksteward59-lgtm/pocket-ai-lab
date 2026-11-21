# Tool workshop repair: observed execution evidence

Recorded 2026-11-21. Implementation: [draft PR #241](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/241), current head `6c01e953ceb6d6633a770a31980aaf19125d5c47`, tree `a4a30278ea00a3c769e2ad0d913a1ee1cd8dbf67`, stacked on PR #240. This evidence records enabled candidate-code experiments through Pocket AI Lab's existing workshop. The current v5 model/prompt/task configuration remains unqualified; the complete product and autonomous self-repair are not accepted.

## What actually happened

| Run | Real model / execution result | Accepted? |
|---|---|---|
| Fixture controls | Initial and v3 runs each had 20 real Docker executions; v4 and v5 each had 21, including an actual compiler-diagnostic case. Faulty source 3/8; scripted correction 8/8; isolation, wrong-output rejection, timeout, output limit, lineage/reopen and cleanup behaved as expected. | Executor controls passed. Corrections are fixture-authored, not model-generated. |
| [v1, 44878327905](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44878327905) | One Director call returned ordinary content without a native function call. No Engineer call, revision, or held-out execution. | No |
| [v2, 44880061412](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44880061412) | Structured Director selected revise and dispatched the real Engineer. Engineer used the 1,024-token limit, but the HTTP backend received no usable final message content/toolCalls. No retained revision or held-out execution. | No |
| [v3, 44881077624](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44881077624) | Three Director calls and two Engineer calls. Both exact Engineer responses were retained as versions 2 and 3, executed, graded and returned as development feedback. Both were prose, not Python. Each scored 0/8 development; final version scored 0/20 held-out versus baseline 4/20. | No: host quality gate rejected the Director's completion claim. |
| [v4, 44890561764](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44890561764) | Three Director calls and two Engineer calls. Both exact source values were `Python source`, matching the illustrative prompt value. Each scored 0/8 development with SyntaxError; final 0/20 held-out. Actual compiler feedback reached the second Engineer. Third revise decision was rejected before another generation. | No: both control and quality failed. |
| [v5, 44892136884](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44892136884) | Director revise → one Engineer generation → Director complete. Exact 334-byte executable source scored 1/8 development and 1/20 held-out, below baseline 3/8 and 4/20. Director stopped with one revision still available. | No: valid terminal protocol, failed repair and false completion judgment. |

The v3 loop exercised actual model choice, generation, persistence, execution, feedback, a second revision, final selection and independent held-out evaluation. It demonstrated the connection, not successful repair. Both generated candidates were quarantined. All 64 live v3 container cases settled and were removed; server shutdown settled and the model file hash remained unchanged.

## Current v5 finding and limits

V4 introduced an optional dedicated source-generation contract through the existing inference provider and bounded development-only compiler diagnostics. Its actual model responses remained invalid Python, but they were parsed from the dedicated source field, retained exactly, executed and returned as feedback. All 64 v4 containers were removed and the server settled; acceptance was false.

V5 explicitly selects `python-source-v2` / `schema-only`, removing illustrative source values from both host code prompts. Separately, it advertises the actual remaining builder attempts to the Director and excludes `revise` at zero. Source schema/parser, compiler diagnostics, model/runtime pins, fixture, two-generation/three-turn budgets, sampling, context and output limits remain unchanged. V1–v4 frozen profiles and their legacy prompt paths remain intact. Both v5 changes are declared; this is not a single-factor causal test.

The actual v5 Engineer response was a 334-byte Python module. It parsed and executed successfully in all 28 candidate development/held-out cases, but every returned value equaled the original input. Static inspection explains this: it encodes and decodes the entire string back to text, counts characters, and returns either the full-length slice or the original string. It does not enforce the byte budget. Independent grading gave **1/8 development and 1/20 held-out**, worse than the deliberately faulty baseline.

The Director received remaining-revision counts **2, then 1**. Its final request included the quarantined `passed:false`, `testsRun:8`, `testsPassed:1` summary and three concrete failure examples. It chose `complete` anyway, with one generation and another Director turn available. Its reason discounted the available results as untrusted. The report's `controlPassed:true` means the bounded protocol reached a valid terminal state; `qualityPassed:false` and `accepted:false` remain decisive.

The zero-budget action filter and stale-balance guard were covered by declared test doubles, but **were not live-exercised by v5**. There was no second Engineer generation in v5. V4 and the actual Docker control establish the compiler-feedback path; v5 did not have a compiler error.

### Evidence audit and follow-up limitation

The archive/report hashes, exact backend source, builder record, stored version-2 file, final selection, artifact lineage, and all 56 case source/artifact/input/expected hashes and grades were independently checked. All 56 containers had unique identities, successful process exits and verified cleanup. The server settled with exit 0. Host integrity checks recorded the model file unchanged; model bytes are not included in the artifact for an independent post-run rehash.

Last model completion was **10:07:19.817 UTC**, final candidate freeze **10:07:19.819 UTC**, and first held-out start **10:07:19.918 UTC**. There was no subsequent model call and no held-out case identifier in requests.

An inherited presentation bug remains: the host shortened the seven candidate findings to three before the planner calculated `findingsTruncated`, so that flag was false despite omitted findings. The explicit failed 1/8 summary was intact. Correct this metadata before another benchmark; do not represent the observed Director context as all seven findings.

This was the final small interface diagnostic in this continuation. No v6 prompt iteration was run. Preserve the failed configuration and define a separate working-baseline/model qualification plan before broader autonomous repair, training or G.I.R.L. experiments. The reused held-out fixture was hidden from model revision context; it is not a fresh generalization benchmark.

## Historical v3 contract finding

The captured Engineer system message asks for a concrete approach and an independent answer in **2–5 sentences**. The experimental user task asks for **raw Python source** in the same `analysis` field. The inherited response schema limits that field to **700 characters**, whereas the builder's separate source-byte cap is 16,384. Both retained strings are exactly 700 characters (700 and 704 UTF-8 bytes), describe the task in prose and fail at line 1 with `SyntaxError`.

There is an output-contract mismatch in the connected model/harness configuration. It prevents interpreting these runs as a clean measure of the model's coding capability. The mismatch is a confound, not a demonstrated sole cause: a correct implementation of this small function would fit below 700 characters. The next scoped change at that checkpoint was a dedicated code-output contract preserving independent analysis, useful bounded compiler feedback, and a separately frozen repeat. That work is implemented and measured as v4/v5 above. This record does not silently repair outputs, substitute scripted code, or reinterpret earlier results.

The Director's final `complete` action was also wrong: the preceding results showed failed, quarantined candidates. The report's `controlPassed: true` means the bounded control protocol reached its completed state. It does **not** mean the model made a correct completion judgment. `qualityPassed: false` and `accepted: false` are the operative results.

V2 did not retain its raw HTTP response. The server log establishes 1,024 generated Engineer tokens; it does not independently establish which response channel consumed them. V3 was a separately frozen diagnostic with a server-wide 128-token reasoning budget for both roles. V2 prompts, model, fixture, total generation limit, revision budget and grading were unchanged. V1–v5 remain separate trials, not retries scored as one result.

## Fixed task and boundaries

The host selected one UTF-8 prefix function with eight visible development cases and twenty held-out cases. It permits two model generations and three Director turns. Expected outputs, grading and final candidate selection belong to the host. The final candidate was frozen before held-out execution, and held-out results were not fed back to the model.

The sandbox used a pinned Python image, no candidate network, read-only root, a non-root user, resource/time/output limits and fresh containers. Candidate mounts include source and the host runner, not repository source, answer keys, credentials or the Docker socket. The existing ToolDirector stores version lineage and quarantines failures. No candidate was activated or installed; no production Pocket source or model weights were changed.

Model: `deepseek-r1-distill-qwen-1.5b-q4_k_m`, 1,117,320,800 bytes, SHA256 `1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f`. Pinned llama.cpp commit `5f490d7bfe78844e6390c869454c149fd7e003a8`; hosted Linux CPU, context 4,096, two threads, zero GPU layers, temperature 0, seed 42, total generation limit 1,024. This is the existing small quantized model used by the project, not a claim to test the newest or largest DeepSeek release.

## Validation and records

[Full repository CI 44892136889](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44892136889) passed at current head `6c01e953ceb6d6633a770a31980aaf19125d5c47`. The same-head workshop contracts and 21 actual Docker controls passed. Local validation included TypeScript, **262 passing focused runtime tests plus one existing skip**, **17 fixture/evidence/profile tests**, syntax and diff checks. Independent source and evidence reviews found no integrity blocker. The live model job failed its quality gate. Earlier validation results remain in provenance history; passing software tests do not override failed model acceptance.

- [provenance.json](provenance.json): exact heads, trees, profiles, fixture/model identities, workflow/job/artifact IDs and verified archive/report hashes.
- [v5-sandbox/sandbox-report.json](v5-sandbox/sandbox-report.json): current-head 21-case real execution controls.
- [v4-sandbox/sandbox-report.json](v4-sandbox/sandbox-report.json): v4 21-case controls.
- [final-sandbox/sandbox-report.json](final-sandbox/sandbox-report.json): preserved v3-head 20-case controls.
- [sandbox/sandbox-report.json](sandbox/sandbox-report.json): initial implementation controls.
- [live-v1/report.json](live-v1/report.json), [live-v2/report.json](live-v2/report.json), [live-v3/report.json](live-v3/report.json), [live-v4/report.json](live-v4/report.json), [live-v5/report.json](live-v5/report.json): actual requests, responses, source versions, per-case outputs and terminal results.
- Each live directory preserves its model-server log and hosted job log. Source-artifact JSON is preserved alongside reports.
- [provisioning-attempt-1.json](provisioning-attempt-1.json) and [provisioning-v2-attempt-1.json](provisioning-v2-attempt-1.json): setup failures before inference (unused upstream UI assets; anonymous GitHub API rate limit). Neither is a model result.

For each v4/v5 sandbox control audit, 20 source/artifact digests were independently recomputed. The isolation probe's exact source includes an unretained dynamic port, so its recorded digest cannot be independently reconstructed from the bundle; its observed result and cleanup are preserved.

Archive digests were checked before extraction; raw report/source bytes are retained. Server log filenames change from `.log` to `.txt` for repository handling, with no content edits. No temporary signed download URLs are published.

## Relationship to the full project

This connects merged workshop #46 and bounded Director work #53–57 to concrete inference/execution adapters. It does not merge ALI #217, skill lifecycle #91/#92, or the separate multi-agent proof #227 into the #240 lineage. ExploitGym integration, G.I.R.L. recipient/alignment and latency evaluation, native application integration and physical iPhone acceptance remain separate unresolved requirements. The previous frozen 1/8 native/text qualification remains unchanged and is not a whole-harness score.

See the [complete product handoff](../../POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md) for the cross-branch map and remaining integration order.

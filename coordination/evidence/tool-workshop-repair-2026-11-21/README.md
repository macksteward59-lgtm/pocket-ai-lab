# Tool workshop repair: observed execution evidence

Recorded 2026-11-21. Implementation: [draft PR #241](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/241), current source `7e1cfcd2b4653f0fea70662d91964cf407be81f1`, tree `f7cdb83d6f8961e7ee5d273fde6986e62e2bc833`, stacked on PR #240. This evidence records enabled candidate-code experiments through the existing workshop. The latest baseline-v1 improved the faulty code but remains unqualified for complete repair; the full product and general autonomous self-repair are not accepted.

## Current baseline-v1 result — partial improvement, repair not qualified

[Workflow 44898332601](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44898332601) ran the separately frozen official Qwen2.5-Coder-7B-Instruct Q4_K_M configuration at source `7e1cfcd2b4653f0fea70662d91964cf407be81f1`, tree `f7cdb83d6f8961e7ee5d273fde6986e62e2bc833`.

| Stage | Actual result |
|---|---|
| Faulty baseline | 3/8 development; 4/20 held-out |
| First model revision, version 2 | 319-byte executable Python source; 6/8 development |
| Second model revision, version 3 | The same exact 319-byte source; 6/8 development |
| Frozen final candidate | 7/20 held-out; incomplete repair |
| Director decisions | revise → revise → blocked; remaining revisions 2 → 1 → 0 |
| Acceptance | `accepted:false`, `qualityPassed:false`, `controlPassed:false` |

All five real provider calls completed successfully, each within 95 seconds. There was no setup, provider, compiler, timeout or container failure. The terminal `blocked` was valid: both allowed generations had been consumed and the code still failed. The existing `controlPassed` field requires a completed outcome; false here does not mean malformed control or false completion. This single configuration improved some scores but did not establish a working repair baseline.

### Exact failure and feedback

Both Engineer outputs, builder records, retained artifacts and final selection contain the same source, SHA-256 `209ecb52f53d0f45f9727f868b605e9ad4090ddbf03d9f162c7b6f77e97785e3`. Static inspection identifies the defect: the code locates a boundary by indexing UTF-8 bytes, then uses that byte offset in `text[:i]`, which slices Python characters. It returned `漢字A` for a four-byte budget (expected `漢`) and `éx` for a two-byte budget (expected `é`).

The second Engineer received the exact previous source, failed 6/8 summary and both actual failure findings, but repeated the code unchanged. Versions 2 and 3 have the same canonical artifact digest because their specification and source match; version history and previousDigest linkage remain correct. There was one distinct revised solution, not two independent successes.

The corrected Director observations retain actual tool/version/digest, quarantined status, 6/8 counts and both complete findings. Original/included counts are 2/2; both truncation flags are correctly false. No generated source bundle enters the Director outcomes, while the initial objective intentionally retains the faulty baseline source. At zero generations, both the available actions and schema exclude revise; the final model action is blocked, with no third Engineer call.

This live run exercised normal projected feedback and the zero-budget action filter. The >6,000-character artifact, seven-to-three finding selection and long-finding clipping are declared contract-test coverage, not live coverage here: these candidate artifacts were only 2,359 serialized characters with two short findings. Compiler feedback was exercised by actual sandbox controls, not by the syntactically valid live candidates. The in-flight stale-budget guard remains declared-test coverage.

### Observation correction and historical limits

Review of the preserved v4 requests identified an additional defect beyond v5's wrong truncation flag. Large v4 artifacts were converted to a generic serialized preview by DirectorTaskRunner before the legacy wrapper read typed metadata. Later Director requests therefore contained null status/identity/grade counts and empty findings. The Engineer still received the compiler findings through its separate artifact-store path. This diagnosis does not alter any old source, request, score or result.

Baseline-v1 explicitly selects `host-artifact-summary-v1`: project the actual artifact before the existing snapshot, retain identity and grade counts plus three bounded findings, and validate original/included counts and clipping metadata before inference. The runner still sanitizes, bounds and freezes history, and retains `untrusted-tool-output`. Provenance is not authorization or a replacement for host grading. Omission preserves v1–v5 behavior and exact frozen profile bytes.

### Identity, runtime and audit

The official model artifact is pinned to publisher revision `13fb94bfda8c8cf22497dc57b78f391a9acb426a`, 4,683,073,536 bytes, SHA-256 `509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c`, Apache-2.0. The pinned model card does not attest the conversion's upstream model revision. The separate license revision is not treated as conversion provenance.

The same llama.cpp source pin, source prompts/parser, initial objective, fixture, grading, context 4,096, two CPU threads, zero GPU layers, temperature 0, seed 42, 1,024-token ceiling and two-generation/three-turn budget remain. The baseline explicitly changes model and feedback contract, omits the R1 reasoning-budget option, and declares 300-second provider / 900-second acquisition limits. It is a new configuration, not a model-only causal comparison, newest-model claim, or v6 prompt iteration. Existing default/pins and all earlier trials remain intact.

The observed host was Linux/x64 with four available CPUs and 16,760,340,480 bytes total RAM. Provider calls totaled about 371.9 seconds; the experiment wall interval was 413.675 seconds. Prompt reuse and the single host/run prevent treating those timings as a general model speed comparison. OS snapshots do not measure peak model memory or establish iPhone fit.

Independent audits recomputed all 64 case source/artifact/input/expected hashes, raw output bytes and grades. All 64 distinct containers exited 0 and were verified absent; server exit 0 settled with no log overflow. The host reported the model file unchanged. The GGUF is not bundled for an independent post-run rehash.

Last model completion was **11:30:14.816 UTC**, candidate freeze **11:30:14.819 UTC**, and first held-out start **11:30:14.929 UTC**. No held-out identifiers appeared in model requests and no later model call occurred. The known held-out fixture was withheld during revision but reused; it is not fresh generalization evidence.

The one predeclared trial is complete. No prompt change, token expansion, handwritten repair substitution or additional model trial followed the result. The next gate is a separately frozen multiple-task ordinary code/control qualification and model-role comparison before autonomous experimentation, learner/teacher training or G.I.R.L. efficiency claims.

## Preserved trial history

| Run | Real model / execution result | Accepted? |
|---|---|---|
| Fixture controls | Initial and v3 runs each had 20 real Docker executions; v4, v5 and baseline-v1 each had 21, including an actual compiler-diagnostic case. Faulty source 3/8; scripted correction 8/8; isolation, wrong-output rejection, timeout, output limit, lineage/reopen and cleanup behaved as expected. | Executor controls passed. Corrections are fixture-authored, not model-generated. |
| [v1, 44878327905](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44878327905) | One Director call returned ordinary content without a native function call. No Engineer call, revision, or held-out execution. | No |
| [v2, 44880061412](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44880061412) | Structured Director selected revise and dispatched the real Engineer. Engineer used the 1,024-token limit, but the HTTP backend received no usable final message content/toolCalls. No retained revision or held-out execution. | No |
| [v3, 44881077624](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44881077624) | Three Director calls and two Engineer calls. Both exact Engineer responses were retained as versions 2 and 3, executed, graded and returned as development feedback. Both were prose, not Python. Each scored 0/8 development; final version scored 0/20 held-out versus baseline 4/20. | No: host quality gate rejected the Director's completion claim. |
| [v4, 44890561764](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44890561764) | Three Director calls and two Engineer calls. Both exact source values were `Python source`, matching the illustrative prompt value. Each scored 0/8 development with SyntaxError; final 0/20 held-out. Actual compiler feedback reached the second Engineer. Third revise decision was rejected before another generation. | No: both control and quality failed. |
| [v5, 44892136884](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44892136884) | Director revise → one Engineer generation → Director complete. Exact 334-byte executable source scored 1/8 development and 1/20 held-out, below baseline 3/8 and 4/20. Director stopped with one revision still available. | No: valid terminal protocol, failed repair and false completion judgment. |
| [baseline-v1, 44898332601](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44898332601) | Three Director calls and two Engineer calls. Identical 319-byte revisions each scored 6/8 development; final 7/20 held-out versus baseline 4/20. Valid blocked after two attempts; actual compact feedback and zero-budget filtering observed. | No: partial improvement, incomplete functional repair. |

The v3 loop exercised actual model choice, generation, persistence, execution, feedback, a second revision, final selection and independent held-out evaluation. It demonstrated the connection, not successful repair. Both generated candidates were quarantined. All 64 live v3 container cases settled and were removed; server shutdown settled and the model file hash remained unchanged.

## Historical v5 finding and limits

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

Historical v1–v5 model: `deepseek-r1-distill-qwen-1.5b-q4_k_m`, 1,117,320,800 bytes, SHA256 `1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f`. Pinned llama.cpp commit `5f490d7bfe78844e6390c869454c149fd7e003a8`; hosted Linux CPU, context 4,096, two threads, zero GPU layers, temperature 0, seed 42, total generation limit 1,024. This is the existing small quantized model used by the project, not a claim to test the newest or largest DeepSeek release.

## Validation and records

[Full repository CI 44898332609](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44898332609) passed at current source `7e1cfcd2b4653f0fea70662d91964cf407be81f1`. The same-head workshop contracts and 21 actual Docker controls passed. Local validation included TypeScript, **295 passing focused runtime tests plus one existing skip**, **18 fixture/evidence/profile tests**, **42 existing pin/acquisition tests**, syntax/YAML/diff checks and frozen-profile/default preservation. Hosted contracts independently passed the 295 runtime and 18 fixture/evidence/profile tests. Independent source, feedback and evidence audits found no integrity blocker. The live job failed functional acceptance. Historical validation remains in provenance; software checks do not override a failed model result.

- [live-baseline-v1/report.json](live-baseline-v1/report.json), [trial provenance](live-baseline-v1/provenance.json), and [baseline-v1-sandbox/sandbox-report.json](baseline-v1-sandbox/sandbox-report.json): current exact-source live result and 21 actual fixture controls.
- [provenance.json](provenance.json): exact heads, trees, profiles, fixture/model identities, workflow/job/artifact IDs and verified archive/report hashes.
- [v5-sandbox/sandbox-report.json](v5-sandbox/sandbox-report.json): v5-head 21-case real execution controls.
- [v4-sandbox/sandbox-report.json](v4-sandbox/sandbox-report.json): v4 21-case controls.
- [final-sandbox/sandbox-report.json](final-sandbox/sandbox-report.json): preserved v3-head 20-case controls.
- [sandbox/sandbox-report.json](sandbox/sandbox-report.json): initial implementation controls.
- [live-v1/report.json](live-v1/report.json), [live-v2/report.json](live-v2/report.json), [live-v3/report.json](live-v3/report.json), [live-v4/report.json](live-v4/report.json), [live-v5/report.json](live-v5/report.json): actual requests, responses, source versions, per-case outputs and terminal results.
- Each live directory preserves its model-server log and hosted job log. Source-artifact JSON is preserved alongside reports.
- [provisioning-attempt-1.json](provisioning-attempt-1.json) and [provisioning-v2-attempt-1.json](provisioning-v2-attempt-1.json): setup failures before inference (unused upstream UI assets; anonymous GitHub API rate limit). Neither is a model result.

For each v4/v5/baseline-v1 sandbox control audit, 20 source/artifact digests were independently recomputed. The isolation probe's exact source includes an unretained dynamic port, so its recorded digest cannot be independently reconstructed from the bundle; its observed result and cleanup are preserved.

Archive digests were checked before extraction; raw report/source bytes are retained. Server log filenames change from `.log` to `.txt` for repository handling, with no content edits. No temporary signed download URLs are published.

## Relationship to the full project

This connects merged workshop #46 and bounded Director work #53–57 to concrete inference/execution adapters. It does not merge ALI #217, skill lifecycle #91/#92, or the separate multi-agent proof #227 into the #240 lineage. ExploitGym integration, G.I.R.L. recipient/alignment and latency evaluation, native application integration and physical iPhone acceptance remain separate unresolved requirements. The previous frozen 1/8 native/text qualification remains unchanged and is not a whole-harness score.

See the [complete product handoff](../../POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md) for the cross-branch map and remaining integration order.

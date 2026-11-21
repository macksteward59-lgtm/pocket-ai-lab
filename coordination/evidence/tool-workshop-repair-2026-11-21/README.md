# Tool workshop repair: observed execution evidence

Recorded 2026-11-21. Implementation: [draft PR #241](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/241), head `d3294457e65e59a3d4d53510441f5a6b79474852`, tree `ac840eabe97fad684ad447e4fa98746d1bec8fa2`, stacked on PR #240. This evidence records an enabled candidate-code experiment through Pocket AI Lab's existing workshop. It does not mark the complete product or autonomous self-repair accepted.

## What actually happened

| Run | Real model / execution result | Accepted? |
|---|---|---|
| Fixture controls, initial and current head | Twenty real Docker executions per control run: faulty source 3/8; scripted corrected source 8/8; isolation, wrong-output rejection, timeout, output limit, version persistence and cleanup behaved as expected. | Executor controls passed. The correction is fixture-authored, not model-generated. |
| [v1, 44878327905](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44878327905) | One Director call returned ordinary content without a native function call. No Engineer call, revision, or held-out execution. | No |
| [v2, 44880061412](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44880061412) | Structured Director selected revise and dispatched the real Engineer. Engineer used the 1,024-token limit, but the HTTP backend received no usable final message content/toolCalls. No retained revision or held-out execution. | No |
| [v3, 44881077624](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44881077624) | Three Director calls and two Engineer calls. Both exact Engineer responses were retained as versions 2 and 3, executed, graded and returned as development feedback. Both were prose, not Python. Each scored 0/8 development; final version scored 0/20 held-out versus baseline 4/20. | No: host quality gate rejected the Director's completion claim. |

The v3 loop exercised actual model choice, generation, persistence, execution, feedback, a second revision, final selection and independent held-out evaluation. It demonstrated the connection, not successful repair. Both generated candidates were quarantined. All 64 live v3 container cases settled and were removed; server shutdown settled and the model file hash remained unchanged.

## Why v3 failed, and what the evidence cannot decide

The captured Engineer system message asks for a concrete approach and an independent answer in **2–5 sentences**. The experimental user task asks for **raw Python source** in the same `analysis` field. The inherited response schema limits that field to **700 characters**, whereas the builder's separate source-byte cap is 16,384. Both retained strings are exactly 700 characters (700 and 704 UTF-8 bytes), describe the task in prose and fail at line 1 with `SyntaxError`.

There is an output-contract mismatch in the connected model/harness configuration. It prevents interpreting these runs as a clean measure of the model's coding capability. The mismatch is a confound, not a demonstrated sole cause: a correct implementation of this small function would fit below 700 characters. A future scoped change should give source generation a dedicated code-output contract, preserve the independent-analysis interface for its existing consumers, expose useful bounded compiler feedback, and repeat under a new frozen profile. This record does not silently repair outputs, substitute scripted code, or reinterpret earlier results.

The Director's final `complete` action was also wrong: the preceding results showed failed, quarantined candidates. The report's `controlPassed: true` means the bounded control protocol reached its completed state. It does **not** mean the model made a correct completion judgment. `qualityPassed: false` and `accepted: false` are the operative results.

V2 did not retain its raw HTTP response. The server log establishes 1,024 generated Engineer tokens; it does not independently establish which response channel consumed them. V3 was a separately frozen diagnostic with a server-wide 128-token reasoning budget for both roles. V2 prompts, model, fixture, total generation limit, revision budget and grading were unchanged. V1, v2 and v3 remain separate trials, not retries scored as one result.

## Fixed task and boundaries

The host selected one UTF-8 prefix function with eight visible development cases and twenty held-out cases. It permits two model generations and three Director turns. Expected outputs, grading and final candidate selection belong to the host. The final candidate was frozen before held-out execution, and held-out results were not fed back to the model.

The sandbox used a pinned Python image, no candidate network, read-only root, a non-root user, resource/time/output limits and fresh containers. Candidate mounts include source and the host runner, not repository source, answer keys, credentials or the Docker socket. The existing ToolDirector stores version lineage and quarantines failures. No candidate was activated or installed; no production Pocket source or model weights were changed.

Model: `deepseek-r1-distill-qwen-1.5b-q4_k_m`, 1,117,320,800 bytes, SHA256 `1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f`. Pinned llama.cpp commit `5f490d7bfe78844e6390c869454c149fd7e003a8`; hosted Linux CPU, context 4,096, two threads, zero GPU layers, temperature 0, seed 42, total generation limit 1,024. This is the existing small quantized model used by the project, not a claim to test the newest or largest DeepSeek release.

## Validation and records

[Full repository CI 44881077615](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44881077615) passed at the current implementation head. The same-head workshop contracts and actual Docker controls passed. Local validation included TypeScript, 110 focused runtime cases, 14 fixture/evidence cases, and the initial 36 web tests. Anonymous/authenticated source verification controls passed. Model acceptance remains failed.

- [provenance.json](provenance.json): exact heads, trees, profiles, fixture/model identities, workflow/job/artifact IDs and verified archive/report hashes.
- [final-sandbox/sandbox-report.json](final-sandbox/sandbox-report.json): current-head real execution controls.
- [sandbox/sandbox-report.json](sandbox/sandbox-report.json): initial implementation controls.
- [live-v1/report.json](live-v1/report.json), [live-v2/report.json](live-v2/report.json), [live-v3/report.json](live-v3/report.json): actual requests, responses, source versions, per-case outputs and terminal results.
- Each live directory preserves its model-server log and hosted job log. Source-artifact JSON is preserved alongside reports.
- [provisioning-attempt-1.json](provisioning-attempt-1.json) and [provisioning-v2-attempt-1.json](provisioning-v2-attempt-1.json): setup failures before inference (unused upstream UI assets; anonymous GitHub API rate limit). Neither is a model result.

Archive digests were checked before extraction; raw report/source bytes are retained. Server log filenames change from `.log` to `.txt` for repository handling, with no content edits. No temporary signed download URLs are published.

## Relationship to the full project

This connects merged workshop #46 and bounded Director work #53–57 to concrete inference/execution adapters. It does not merge ALI #217, skill lifecycle #91/#92, or the separate multi-agent proof #227 into the #240 lineage. ExploitGym integration, G.I.R.L. recipient/alignment and latency evaluation, native application integration and physical iPhone acceptance remain separate unresolved requirements. The previous frozen 1/8 native/text qualification remains unchanged and is not a whole-harness score.

See the [complete product handoff](../../POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md) for the cross-branch map and remaining integration order.

# Existing tool workshop: executable code-repair experiment

## Purpose and current scope

This connects the existing ToolDirector revision lifecycle to a real inference
adapter and an isolated Python execution adapter. It responds to the owner's
requirement to evaluate the capabilities of the connected Pocket AI Lab harness.
It reuses DirectorTaskRunner, DirectorCommandRouter, ToolDirector,
InferenceProvider, the llama.cpp adapters and FileToolArtifactStore.

The first exercise is a deliberately small UTF-8 prefix function. It is a
candidate-code repair experiment, with one host-selected task and model-selected
revisions or stopping decisions. It is not a native Pocket source patch, general
autonomous experimentation, model-weight training, an ExploitGym result, or a
G.I.R.L. recipient-language benchmark.

The experimental host exposes only develop-tool and the existing task-control
outcomes. Generated candidates are never activated or installed. The ordinary
web composition remains read-only and now advertises only the adapters it
actually supplies: project analysis, plus research when configured.

## Observed v1 result and separate v2 diagnostic

At source head `0083f561f94b6835265cba062cf263421725836e`,
[workflow 44878327905](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44878327905)
verified and loaded the pinned real DeepSeek model. The faulty baseline executed
all eight development cases and passed three. The model made one Director
generation but returned ordinary content without the required native function
call. The adapter rejected it. There were zero Engineer calls, no revised
candidate and no held-out execution. Acceptance was false. Model integrity and
server/container cleanup passed. This measures a failure at the command
interface, before code-generation quality could be tested.

The separate fixture-source Docker controls passed: 20 actual container cases,
3/8 baseline and 8/8 scripted revision, durable artifact lineage/reopen, isolation,
wrong-output rejection, timeout, output cap and verified cleanup. Those controls
do not count as model-generated repair.

The initial provisioning attempt in workflow 44877989061 failed before model
acquisition/inference because optional upstream web UI assets did not match the
pinned server. The API host now disables optional UI provisioning. The failure
is retained separately from model results.

Profile v2 is an explicitly separate interface diagnostic. It adds
StructuredRepairPlanner, which asks the model for a strict JSON object containing
an action (revise, complete or blocked) and a short reason. The host binds revise
to its immutable repair specification and dispatches the existing develop-tool
command. It never supplies a replacement source implementation or a model answer.
Source generation still uses the real Engineer provider, and actual execution
and grading still use the same workshop and host sandbox.

V2 keeps the model artifact, context/sampling settings, Engineer interface,
fixture, two-generation budget and held-out rules unchanged. It changes the
Director prompt/protocol and removes the need to reproduce the complete host
specification in a function call. Its outputs and calls are recorded separately.
A v2 success would not pass v1's native function-calling gate or establish a
general autonomous-repair success rate.

The v1 profile bytes remain unchanged. profile.mjs verifies each independently
frozen profile hash and only accepts an explicit v1, v2, v3, v4 or v5 selector. The default
remains v1; there is no automatic profile switch after failure.

### Observed v2 dispatch and separate v3 output-budget diagnostic

At `8777e4f2fe5e311be78dc04c98155c0168b36511`,
[v2 workflow44880061412](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44880061412)
made two real calls. The structured Director selected revise; the existing
workshop invoked the Engineer. The Engineer generated 1,024 tokens, then the
existing HTTP adapter reported neither usable final content nor tool calls.
One build attempt failed before retaining source. The baseline remained at 3/8;
no revised artifact or held-out result existed. Cleanup and model integrity
passed. This is an output-contract failure before code quality was measured.

The raw HTTP response body was not retained. The hypothesis that emitted
thinking consumed the generation allowance is therefore not a directly observed
response-channel fact. V3 tests one targeted configuration change:
`--reasoning-budget 128`, supported by the pinned server's README. It preserves
the v2 planner and Engineer prompts, model, context/sampling, 1,024-token response
ceiling, fixture, two-generation/three-turn budgets and held-out gate. It does not
reinterpret reasoning as source or relax the response parser. Each profile and
outcome remains separately identified. A timing difference would not establish
a learned internal language or a general speedup.

## Observed v3 and the separate v4 code contract

[V3 workflow 44881077624](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44881077624)
at source `d3294457e65e59a3d4d53510441f5a6b79474852` made five real model calls.
Two Engineer outputs were retained, executed and returned as feedback. Both were
700-character prose and failed with Python syntax errors: 0/8 development each,
final 0/20 held-out versus baseline 4/20. The Director claimed complete despite
quarantined failures. Host quality acceptance was false. All 64 containers were
cleaned up and the model hash was unchanged. The raw record is preserved in the
[coordination evidence](https://github.com/macksteward59-lgtm/pocket-ai-lab/tree/a00fc33c51fe21b829adc06c69ea69ddea8621c6/coordination/evidence/tool-workshop-repair-2026-11-21).

The existing Engineer system asked for a short analysis in 2–5 sentences while
the task requested raw Python. That inconsistency is a confound, not proof of
the sole cause; a correct small function fits below the old 700-character cap.

V4 explicitly selects `InferenceProvider.generateCode` and `python-source-v1`.
The existing llama.cpp provider delegates to a consistent code-only contract:
one JSON object with a `source` string, no analysis-stage instruction, fixed
Python language and bounded source. It uses the same backend, model settings,
timeout and one completion attempt. Providers without this optional capability
are rejected; there is no fallback into ordinary analysis. Standard `generate`
and its stage schemas/parsers retain their previous behavior.

Source bytes are preserved exactly. Invalid JSON, extra/duplicate fields,
function calls, Markdown fences, NUL, invalid Unicode or oversized source fail
closed. Syntactic or semantic Python mistakes are left to actual sandbox
execution and independent host grading, not rewritten by the host.

V4 also opts into bounded compiler/process diagnostics for development results.
The final stderr line and a bounded stderr tail are labeled untrusted candidate
output, with explicit truncation and execution-status fields. Raw process bytes
remain in evidence. Ordinary wrong-answer findings without process diagnostics
retain their original form, including the initial Director objective. Held-out
adapters do not enable diagnostics and still run only after the final candidate
is frozen. A real Docker syntax-failure control verifies this feedback path even
if the live model does not need a second revision.

The fixture, model, Director protocol, sampling, context, 1,024-token limit,
128-token thinking cap, two generations/three Director turns, selection and
acceptance rules are unchanged from v3. This is a new configuration trial, not
a rescore. The known held-out fixture is withheld from each model revision
context; reusing it does not create a fresh generalization benchmark. No result
from this single task establishes whole-harness reliability or language speedup.

## Observed v4 and the final v5 interface diagnostic

[V4 workflow 44890561764](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44890561764)
at source `aae5efc89d51ce4d52ccab1d2b37e4a3059c034b` made five real model calls.
Both Engineer outputs contained exactly `Python source`, the illustrative value
shown in the builder prompt. Both artifacts were preserved unchanged and failed
all eight development cases with Python syntax errors. The second Engineer
request included all eight actual compiler findings. The Director requested a
third revision; the existing two-generation limit rejected it before another
Engineer call. After final candidate selection, held-out quality was 0/20 versus
baseline 4/20. Both control and quality acceptance were false. All 64 containers were cleaned up,
the server settled and the model hash was unchanged. The raw evidence is in
[the preserved v4 record](https://github.com/macksteward59-lgtm/pocket-ai-lab/tree/b38ca9cb3e86b7bdc36b8236d306fbf76d92d866/coordination/evidence/tool-workshop-repair-2026-11-21/live-v4).

V4's software checks and its 21 actual Docker control cases passed, including a
real syntax-error diagnostic. Passing those checks establishes the adapter and
feedback paths, not successful model repair.

V5 declares two changes. Explicit `python-source-v2` selects schema-only code
prompts without illustrative source values; it keeps the same source schema,
parser, source-byte preservation and compiler feedback. The optional
`getRemainingRevisions` callback reads the actual builder attempt count. The
Director request includes that remaining count and removes `revise` from both
available actions and its output schema at zero. Failed build attempts also
consume this allowance. Model-authored history cannot replenish it. Existing
host limits remain independent, and complete/blocked stopping actions do not
override the host's quality grading.

V1-v4 prompt behavior and frozen profile bytes remain unchanged. V5 retains the
same model/runtime pins, task, initial objective, sampling, context and token
settings, two Engineer generations and three Director turns. It supplies no
handwritten implementation or answer example. Because both prompt formatting
and capability advertisement change, a result cannot establish either one as
the sole cause. This is the final small interface diagnostic in this
continuation; failure leaves this configuration unqualified and ends these
small prompt iterations on the reused task.

## Recovered existing implementation

The November 21 cross-conversation and branch audit identified:

| Existing work | Actual responsibility |
|---|---|
| Merged Director workshop PR #46 | Create/extend/revise/test/quarantine/activate/retire lifecycle, injected builder and sandbox |
| Bounded Director loop #53, native function calling #54, composition #55, web integration #57 | Model command, validated dispatch, tool feedback, bounded next turn |
| FileToolArtifactStore | Durable source versions and digest lineage |
| ALI #217 | Separate evidence/proposal/candidate-training/evaluation layer; not a connected code executor |
| Autonomous project run #96 | Read-only audit workflow; resume records intent |
| Parallel execution #116 | Engineering coordination design, superseded into #115 |
| Native self-evaluation #135/#140 | Native model response generation and evaluation journal |
| ExploitGym restoration #165 | Pinned upstream source boundary; no Pocket sandbox adapter |

The inspected branches did not establish an operational model-generated
code/execution/repair loop. The workshop itself already preserved failed source,
test findings and revisions. Its missing concrete host adapters are the focus of
this change. Earlier or external work not recovered by the audit is not declared
nonexistent.

## Connected path

1. The host loads the immutable fixture and frozen model profile.
2. The existing workshop records and actually executes the intentionally faulty
   baseline through Docker on all eight development cases.
3. Only valid executed comparisons may establish baseline quality. A Docker
   failure, timeout or uncertain cleanup blocks the experiment.
4. The Director receives the task, faulty source, actual development findings,
   available command set and fixed revision budget.
5. A model-selected develop-tool revision calls InferenceToolBuilder using the
   existing Engineer inference interface.
6. The Engineer receives the previous candidate and development feedback,
   returning one raw Python module in payload.analysis for v1–v3 or in the dedicated source field for v4–v5.
7. ToolDirector records the version, invokes the sandbox and records actual
   findings. The next Director turn receives a compact outcome-first observation.
8. The model may request at most two source generations in total, or stop. The
   host freezes the latest retained candidate before any held-out evaluation.
9. Baseline and final candidate are evaluated on the same 20 held-out cases.
   No model call follows that point.

The existing native Director adapter bounds a history preview to 2,000
characters. Passing a full artifact could put its test summary beyond that
limit. The experimental host therefore sends status, counts and a bounded sample
of development findings first. Full source, all findings and version history
remain in the report and artifact store.

## Frozen task and model profile

The task is to return the longest unchanged starting prefix that fits a UTF-8
byte budget, ending between complete Unicode code points. It does not promise
complete grapheme clusters or normalization.

The fixture contains eight development and 20 held-out cases. Its literal answer
keys are pinned by SHA-256:

    00b849a53254d1a28612b4d0bac2b15c24317a7c18af18fb36c52a27fe44ab6d

The deliberately faulty baseline slices Python characters by the byte budget.
The tests cover multibyte boundaries, combining sequences, astral characters,
control characters, zero/empty inputs and prefix preservation. Invalid protocol
inputs are rejected separately from the code-repair score.

The first live profile reuses the already reviewed
DeepSeek-R1-Distill-Qwen-1.5B Q4_K_M pin:

- Model SHA-256:
  1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f.
- Existing llama.cpp commit:
  5f490d7bfe78844e6390c869454c149fd7e003a8.
- One model for both Director and Engineer, hosted CPU execution.
- Context 4,096; maximum response 1,024 tokens; temperature zero; seed 42.
- At most three Director turns and two Engineer generations.
- No provider-level output repair retries or alternative model fallback.
- Profiles v1–v3 retain the existing independent-stage analysis schema, which
  limits source to 700 characters. V4–v5 explicitly select the dedicated code
  contract with the existing 16,384-byte source cap; it does not change ordinary
  analysis schemas or implicitly switch older profiles.

This profile is a separate experiment. It does not alter the native eight-case
DeepSeek qualification, its parser, its 1/8 outcome, or its evidence.

## Execution and grading boundaries

DockerPythonToolSandbox requires a locally installed image referenced by a
repository digest. It inspects the actual image ID and uses that immutable ID
for candidate creation. It does not pull images or fall back to host Python.

Each case gets a fresh constrained container with:

- Network mode none and a private process namespace.
- Read-only root filesystem, nonroot UID/GID, dropped capabilities and
  no-new-privileges.
- Bounded memory, swap, CPU, PID count, wall-clock time and output.
- Only the candidate module and embedded trusted invocation helper mounted
  read-only.
- No repository, expected answers, Docker socket, credentials or previous-case
  state.

The container receives only text and byteLimit. It returns one canonical JSON
result. The host validates the process outcome and compares that result with a
literal expected answer kept outside the container. Candidate-written success
claims are not a grade.

Development-only diagnostics can include bounded input, actual and expected
values. Held-out adapters omit that model-facing feedback, and the host makes no
further model call after selecting the final candidate.

Timeouts and output-limit violations terminate the owned container. Removal and
independent absence checks are recorded. An uncertain creation acknowledgement
or unverifiable cleanup quarantines the experiment and blocks further model or
sandbox work.

The adapter uses Docker controls documented at
https://docs.docker.com/engine/containers/run/ . Runtime preflight checks required
host capabilities; a successful unit fixture is not proof those controls were
enforced.

## Evidence and acceptance

The report retains:

- Exact source HEAD/tree, fixture/profile identities and observed model hash.
- Inspected sandbox image/daemon identity and embedded helper digest.
- Server arguments, owned process ID, binary hash, logs and shutdown outcome.
- Actual model request parameters and returned provider outputs/errors.
- Initial failure, every retained source version, digest lineage and generation
  attempts, including malformed/failed attempts.
- Per-case bounded raw output, exit/timeout/output-limit outcomes, independent
  comparisons, timestamps and container cleanup.
- Final candidate hash/time before held-out execution.
- Both baseline and candidate held-out results.

Acceptance requires a real candidate, changed source, completed Director control
flow, passing development and held-out cases, improvement over a valid executed
baseline, and verified cleanup/integrity. A failed model call or early stop is
retained as a failed/blocked attempt, not replaced with scripted output.

The report is experimental evidence, not an APEX receipt or cryptographic runtime
attestation. A functional result would establish this one code-repair task.
Source changes can improve an agent's tool without changing the model's weights.

## Validation layers

1. Unit and contract tests use explicitly declared process/provider doubles to
   exercise identity, budgets, malformed outputs, boundaries and cleanup.
2. check-sandbox.mjs executes fixture-authored code in actual Docker. It checks
   failing baseline, corrected revision, durable reopen, host answer comparison,
   read-only/nonroot/network separation, environment exclusion, timeout and
   output-limit handling. A separate intentionally invalid source checks actual
   Python syntax-error feedback and quarantine. It is not model evidence.
3. run-repair.mjs starts the pinned real model server and uses its responses for
   Director decisions and Engineer code. Its quality outcome is separate from
   the software/container checks.

The workflow pins Ubuntu 24.04 and has read-only repository permissions. Its
ordinary pushes run contracts and actual sandbox checks. A workflow dispatch or
an explicit [workshop-live-v1] commit marker runs v1 after those checks pass.
An explicit [workshop-live-v2] marker selects the separate v2 trial.
An explicit [workshop-live-v3] marker selects the v3 thinking-budget diagnostic.
An explicit [workshop-live-v4] marker selects the consistent code-contract trial.
An explicit [workshop-live-v5] marker selects the schema-only prompt and remaining-budget trial.

## Host entry points

The workflow provisions the server from the existing verified llama.cpp source
pin and downloads the model using the existing streaming/hash-verified
acquisition code. No cloud account or provider credentials are required.

For an already provisioned Linux host, run the experiment with Node.js 22+ and
the repository dependencies. Set POCKET_WORKSHOP_EXPERIMENT=1,
POCKET_WORKSHOP_PYTHON_IMAGE to the installed repository digest,
POCKET_WORKSHOP_MODEL to the verified GGUF,
POCKET_WORKSHOP_SERVER to the built llama-server, and POCKET_WORKSHOP_OUTPUT to
a new private directory outside the source checkout. Then run:

    node --import tsx scripts/tool-workshop/run-repair.mjs

Set POCKET_WORKSHOP_PROFILE=v2 only for the separate structured-action trial;
omit it or set v1 to retain the original native function-call profile.
Set v3 only for the separate bounded-thinking profile.
Set v4 only for the explicit source-generation and compiler-feedback contract.
Set v5 only for the explicit schema-only prompts and remaining-revision advertisement.

Missing capabilities stop the attempt. Local development in the current
workspace has no Docker daemon and cannot claim actual candidate execution.
Hosted results must be inspected and recorded by exact source head.

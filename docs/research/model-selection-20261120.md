# Model selection research — 20 November 2026

Status: research recommendation, in review. No candidate has been downloaded, loaded, benchmarked, accepted, or promoted by this work. ExploitGym remains part of the intended project. This document records source findings and a proposed qualification sequence; it is not an executable experiment manifest or a production model configuration.

## Decision

Evaluate **IBM Granite 4.2 3B first for ordinary native text and tool proposals**, **Qwen3.5 4B as the larger capability challenger**, and **MiniCPM5 2B as a separate compact reasoning and numerical-input candidate**. These priorities reflect the current application contract and artifact costs, not a measured quality ranking.

Granite combines a publisher-provided approximately 2.24 GB Q4_K_M artifact with explicitly supported nonthinking and low-effort modes. Qwen's selected 4B artifact is approximately 3.03 GB and is a useful broader-capability comparison. MiniCPM5's approximately 1.56 GB artifact explicitly reports the `llama` architecture required by the current numerical-input bridge, but the publisher supports **thinking mode only for its 2B model**. Ordinary text suitability and numerical-input suitability therefore need separate decisions. [Granite model](https://huggingface.co/ibm-granite/granite-4.2-3b), [Qwen model](https://huggingface.co/Qwen/Qwen3.5-4B), [MiniCPM GGUF](https://huggingface.co/openbmb/MiniCPM5-2B-GGUF), [MiniCPM supported modes](https://github.com/OpenBMB/MiniCPM/blob/main/docs/deployment/transformers.md).

Keep **Qwen3.5 2B** as a lower-memory text alternative. Consider **LFM3 1.7B** for narrow structured-output/tool-selection work, and **Gemma 4 E2B** for a later text/multimodal comparison. Do not install all candidates or load one model per logical role. Preserve the shared pool, sequential deliberation, `InferenceProvider`, APEX/Director, East/e3 and existing authorization boundaries.

## 1. Repository and device constraints

The inspected heads were:

| Surface | Revision | Interpretation |
|---|---|---|
| `main` | `fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873` | Existing registry, router, improvement-review and Director foundations |
| `agent-coordination` at research start | `fce676c113cd95b7e6639c3c988088a6cdaa64d2` | Current coordination and frozen negative evidence |
| Draft PR #234 | `6a61281a1d28a6b8ee1a292c74f8515c2250d110` | Inspected native implementation stack; still unmerged |
| Draft PR #165 | `b89d0bffd319ba940b17c50ee971fa1674dd541f` | ExploitGym source-restoration boundary; still unmerged |
| Pinned llama.cpp | `5f490d7bfe78844e6390c869454c149fd7e003a8` (`b12233`) | Exact runtime source inspected |

The target remains a native offline-first iPhone Air application. Safari is a development/access surface; it does not become the native inference backend. The device's 256 GB storage capacity is not an application RAM budget. Apple's [iPhone Air specifications](https://www.apple.com/iphone-air/specs/) identify an A19 Pro with a five-core GPU but do not publish RAM capacity. An [increased-memory-limit entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.kernel.increased-memory-limit) does not guarantee extra memory on every device.

The following are implementation constraints of the inspected PR #234 stack, not physical-device measurements or claims about everything on `main`:

| Contract | Current behavior | Selection consequence |
|---|---|---|
| Model pool | One loaded model; one concurrent request | Logical agents share inference sequentially |
| Admission | 4,096 MiB estimated pool budget; 512 MiB minimum remaining app-allocatable headroom | Actual acceptance depends on live memory, not storage size |
| Estimate | Model file MiB plus the larger of 256 MiB or 25% | This is not measured peak resident memory |
| Imported-model context | 2,048 tokens by default | Start here before increasing context |
| C context ceiling | Requests over 8,192 rejected | Publisher 128K–512K claims do not describe this app |
| Native agent execution | Up to eight roles, sequential; at most 512 generated tokens per role | Long reasoning can exhaust the existing turn budget |
| Generation interface | Prompt, maximum tokens, temperature | Full sampler, template and reasoning controls are not yet exposed |
| Numerical input | Decoder model with context memory and `general.architecture == "llama"` | Text support for other families does not establish numerical/GIE support |

Sources: [app pool and estimate](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/ios/PocketAILab/LocalChatView.swift), [catalog](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/ios/PocketAILab/LocalModelCatalog.swift), [coordinator](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/runtime/ios/Sources/PocketLlamaEngine/NativeAgentCoordinator.swift), [native C bridge](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/runtime/ios/Sources/LlamaCppBridge/pocket_llama.c).

## 2. Shortlist and tradeoffs

File sizes below are decimal GB for a specific text-model artifact. They exclude process overhead, context state, working buffers, optional projectors and other application memory.

| Candidate | Selected/representative text artifact | License | Recommended role | Main unresolved issue |
|---|---|---|---|---|
| **IBM Granite 4.2 3B** | Publisher Q4_K_M, **2.24 GB** | Apache 2.0 | First general text/tool candidate | Correct mode, sampler and tool parser; physical-phone performance; `granite` excluded by numerical guard |
| **Qwen3.5 4B** | ggml-org Q4_K_M, **3.03 GB** | Apache 2.0 | Broader-capability challenger | More memory; explicit nonthinking configuration; `qwen35` excluded by numerical guard |
| **MiniCPM5 2B** | Publisher Q4_K_M, **1.56 GB** | Apache 2.0 | Compact reasoning and numerical-input preflight | Only thinking mode officially supported; `llama` is only one precondition, not learned GIE compatibility |
| **Qwen3.5 2B** | Bartowski community Q4_K_M, **1.40 GB** | Apache 2.0 | Smaller general-text comparison | Community conversion needs its own full pin; quality and runtime behavior remain unmeasured |
| **LFM3 1.7B** | Publisher Q4_K_M, **1.10 GB** | LFM Open License v1.0 | Narrow tools/structured output | Publisher discourages agentic coding and complex reasoning; custom commercial conditions |
| **Gemma 4 E2B** | Google QAT Q4_0, **3.35 GB** | Apache 2.0 | Later text/multimodal comparison | Limited margin under current estimate; projectors and modality API are separate work |

Primary sources: [Granite card](https://huggingface.co/ibm-granite/granite-4.2-3b), [Qwen 4B card](https://huggingface.co/Qwen/Qwen3.5-4B), [MiniCPM card](https://huggingface.co/openbmb/MiniCPM5-2B), [Qwen 2B card](https://huggingface.co/Qwen/Qwen3.5-2B) and [conversion tree](https://huggingface.co/bartowski/Qwen_Qwen3.5-2B-GGUF/tree/main), [LFM3 card](https://huggingface.co/LiquidAI/LFM3-1.7B) and [license](https://huggingface.co/LiquidAI/LFM3-1.7B/blob/main/LICENSE), [Gemma 4 model card](https://gemma.ai/models/gemma-4/model-card/) and [Google QAT tree](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/tree/main).

### Why Granite is the first ordinary-text experiment

The recommendation favors controllable answer latency and integration cost. Granite explicitly exposes full thinking, nonthinking and low-effort modes, allowing a short-answer baseline before longer deliberation. Its publisher GGUF simplifies provenance. This does not prove superior accuracy, speed or ExploitGym performance. The documented generation profile includes temperature 1.0 and top-p 0.95; Pocket's temperature-only interface cannot currently reproduce that complete profile. The model card also names model-specific reasoning/tool parsers. Those are integration requirements, not capabilities granted merely by registering the model.

### Why Qwen is the challenger

The 4B variant is a dense hybrid model, not a small MoE whose active parameter count explains away storage. It defaults to thinking. The supported way to disable thinking is through the chat-template/API configuration; `/nothink` is not the documented control. The 2B variant defaults to nonthinking and offers a smaller comparison. Optional vision capability is separate from Pocket's present text path. The selected 4B GGUF comes from llama.cpp maintainers (`ggml-org`), while the 2B artifact identified here is a community conversion; neither should be attributed to Qwen's own GGUF account. [Qwen 4B usage](https://huggingface.co/Qwen/Qwen3.5-4B), [Qwen 2B usage](https://huggingface.co/Qwen/Qwen3.5-2B).

### Why MiniCPM deserves its own track

The publisher reports 2,516,756,480 total parameters and a standard Llama architecture. Its official GGUF summary explicitly reports `llama`, matching the current bridge's architecture precondition. This makes it a useful engineering candidate for the numerical path. However, the 2B checkpoint's supported mode is thinking-only. A false branch in a shared chat template does not establish a supported nonthinking model. A longer generation budget must be designed and declared before evaluating it. The existing 512-token role limit may still be restrictive. Passing an architecture check does not supply the missing learned representation mapping or prove generation conditioned on a received GIE. [Specifications](https://huggingface.co/openbmb/MiniCPM5-2B), [GGUF architecture](https://huggingface.co/openbmb/MiniCPM5-2B-GGUF), [supported mode table](https://github.com/OpenBMB/MiniCPM/blob/main/docs/deployment/transformers.md).

### Why the smallest and multimodal alternatives are secondary

Liquid recommends LFM3 for local tool/structured-output applications but explicitly discourages agentic coding and complex multistep reasoning. It is a sensible narrow-worker candidate rather than an assumed universal Engineer. Its default reasoning and potentially inconsistent disabling also require measurement. The LFM license contains a $10 million annual-revenue commercial-use threshold; preserve and review the exact license before distribution. Its published iPhone benchmark used an iPhone 17 Pro and a particular Q4_0/llama.cpp setup, not Pocket on an iPhone Air. [LFM3](https://huggingface.co/LiquidAI/LFM3-1.7B), [license](https://huggingface.co/LiquidAI/LFM3-1.7B/blob/main/LICENSE).

Gemma 4 E2B is listed as 2.3B effective parameters and 5.1B including embeddings. Its Google QAT GGUF language file is approximately 3.35 GB; a separate approximately 987 MB projector is listed. Google's smaller mobile-memory estimates for LiteRT-LM formats are not measurements of this GGUF or Pocket's total process. The current bridge has no multimodal projector/`mtmd` path. The complete monolithic language file can be a text candidate without assuming external PLE-shard loading, speculative decoding or multimodal support. [Model card](https://gemma.ai/models/gemma-4/model-card/), [artifact tree](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/tree/main), [Google runtime formats](https://ai.google.dev/gemma/docs/core).

### Other models considered

- **SmolLM3 3B** is a useful Apache comparison with supported reasoning/nonthinking modes and a roughly 1.92 GB maintainer Q4_K_M. Its GGUF architecture is `smollm3`, outside the current numerical guard. The failure of SmolLM2 135M does not prove this distinct model fails. [Model](https://huggingface.co/HuggingFaceTB/SmolLM3-3B), [GGUF](https://huggingface.co/ggml-org/SmolLM3-3B-GGUF).
- **Ministral 3 3B Instruct** and **Phi-4-mini-instruct** are credible additional comparisons, but expanding the initial matrix indefinitely would delay the reference/native and device checks. [Mistral publisher](https://huggingface.co/mistralai/Ministral-3-3B-Instruct-2512), [Microsoft publisher](https://huggingface.co/microsoft/Phi-4-mini-instruct).
- **Foundation-Sec-8B-Instruct** is a security-specialized host-side research option, not evidence of suitability for the current phone pool. Its model page uses a custom/other license designation. Security specialization does not demonstrate ExploitGym success. [Publisher](https://huggingface.co/fdtn-ai/Foundation-Sec-8B-Instruct).
- **Gemma 4 E4B** and **Qwen3.5 9B** have selected representative Q4 files around 5.15 GB and 6.17 GB respectively, before other allocations, exceeding the current admission estimate. Defer them as phone defaults. [Google E4B tree](https://huggingface.co/google/gemma-4-E4B-it-qat-q4_0-gguf/tree/main), [Qwen conversion tree](https://huggingface.co/bartowski/Qwen_Qwen3.5-9B-GGUF/tree/main).
- Older LFM2/LFM2.5, Granite 4.1 and Qwen3 releases remain possible controls; they should not be described as the latest releases after newer publisher checkpoints were verified.

## 3. Exact artifact identities observed

These are remote pointer metadata, not checksums computed over downloaded weights. Source `main` branches are mutable. A future run must freeze the full model repository revision, tokenizer/template revision and artifact hash, then independently verify the actual downloaded bytes. Metadata availability alone is not a native readiness result.

| Repository and filename | Bytes | SHA-256 |
|---|---:|---|
| `ibm-granite/granite-4.2-3b-GGUF` / `granite-4.2-3b-Q4_K_M.gguf` | 2,244,011,552 | `e0406663965846ae22a403456eb826ccce5f450840491f71952f18a7cb78e7d5` |
| `ggml-org/Qwen3.5-4B-GGUF` / `Qwen3.5-4B-Q4_K_M.gguf` | 3,032,091,584 | `217002fa8008ef4fc6d548353a3aebef055a96e6ff8e0e2c0953ef8254a89c14` |
| `openbmb/MiniCPM5-2B-GGUF` / `MiniCPM5-2B-Q4_K_M.gguf` | 1,561,318,368 | `ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd` |
| `LiquidAI/LFM3-1.7B-GGUF` / `LFM3-1.7B-Q4_K_M.gguf` | 1,099,627,808 | `3793e1e6e2266919d6e015287221b41100175a98eddaba92e111aed3b05c93c4` |
| `google/gemma-4-E2B-it-qat-q4_0-gguf` / `gemma-4-E2B_q4_0-it.gguf` | 3,349,516,256 | `fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634` |

Pointer/file sources: [Granite](https://huggingface.co/ibm-granite/granite-4.2-3b-GGUF/blob/main/granite-4.2-3b-Q4_K_M.gguf), [Qwen](https://huggingface.co/ggml-org/Qwen3.5-4B-GGUF/raw/main/Qwen3.5-4B-Q4_K_M.gguf), [MiniCPM](https://huggingface.co/openbmb/MiniCPM5-2B-GGUF/blob/main/MiniCPM5-2B-Q4_K_M.gguf), [LFM3](https://huggingface.co/LiquidAI/LFM3-1.7B-GGUF/raw/main/LFM3-1.7B-Q4_K_M.gguf), [Gemma](https://huggingface.co/google/gemma-4-E2B-it-qat-q4_0-gguf/blob/main/gemma-4-E2B_q4_0-it.gguf).

The Qwen 2B fallback remains a research entry with a verified repository listing rather than a full artifact pin in this table. Different converters, quantizations, QAT variants and auxiliary MTP/draft files are distinct candidates. A small auxiliary file is not the full language model.

## 4. Runtime support and remaining integration

The exact llama.cpp pin is a 9 November 2026 commit. It already contains [Gemma 4](https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/src/models/gemma4.cpp), [Qwen3.5](https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/src/models/qwen35.cpp) and [LFM3](https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/src/models/lfm3.cpp) source support. Its [Metal backend](https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/ggml/src/ggml-metal/ggml-metal-device.m) contains the relevant operator paths with device/shape conditions. Do not prescribe an upgrade merely because the model family is new. Exact-artifact loading, correct operations and actual device execution still require tests.

Pocket's bridge directly tokenizes a supplied string and loads a single model path. It does not automatically inherit CLI chat formatting, reasoning switches, tool parsers, the full sampling chain, auxiliary-shard configuration or multimodal support. The [pin's external PLE change](https://github.com/ggml-org/llama.cpp/commit/5f490d7bfe78844e6390c869454c149fd7e003a8) is not evidence that every one of these features is exposed by Pocket.

A versioned model profile should bind the artifact identity to the rendered chat template, special tokens, thinking mode, sampler, stop rules, context, output budget, final-answer parser and tool-call parser. Implement and test those behind the existing inference abstraction. Use model documentation as input to that contract without replacing APEX/East with an unrelated agent framework.

For G.I.R.L./GIE work, preserve the existing capture/codebook/decoder/numerical-runtime foundations. The [recipient gap audit](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/fce676c113cd95b7e6639c3c988088a6cdaa64d2/docs/implementation/native-gie-recipient-gap-audit-20261120.md) identifies the still-missing learned representation mapping, conditioned recipient operation and production integration. A model swap cannot establish these by itself.

## 5. Preserve ExploitGym and finish the existing integration

The exact intended upstream is **[sunblaze-ucb/exploitgym](https://github.com/sunblaze-ucb/exploitgym)**. Draft PR #165 pins `packages/exploitgym` to **`a8029e47135a29f1c1a6e79109bf86fba379b3f3`**. Its [integration document](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/b89d0bffd319ba940b17c50ee971fa1674dd541f/docs/integrations/exploitgym.md) explicitly records only a source reference and integration boundary. It is not merged into current `main` or the inspected native stack, and it does not claim an adapter or workload run.

The pinned [v1.0 README](https://github.com/sunblaze-ucb/exploitgym/blob/a8029e47135a29f1c1a6e79109bf86fba379b3f3/README.md) describes **869 instances**. The earlier 898-instance announcement is not the count for this pinned release. Code is Apache 2.0; task data retains separate licenses. Reuse this benchmark rather than replacing it or relabeling Pocket's simpler tests as ExploitGym.

| Existing layer | Intended responsibility | Missing connection |
|---|---|---|
| Native inference and model pool | Produce model outputs under the app's resource limits | Qualified model profile and exact native invocation |
| APEX/Director and East/e3 | Route bounded work through existing authorization and evidence controls | Concrete host composition for benchmark tools |
| ExploitGym isolated Linux worker | Prepare and evaluate approved benchmark workloads | Pocket adapter and explicit enforcement profile |
| Evidence/improvement review | Retain trajectories, failures, identities and paired results | Result translation and independent assessment |

The upstream [`Agent.run` interface](https://github.com/sunblaze-ucb/exploitgym/blob/a8029e47135a29f1c1a6e79109bf86fba379b3f3/src/cybergym/evaluation/agents/base.py) is the useful adapter seam. Its [runner](https://github.com/sunblaze-ucb/exploitgym/blob/a8029e47135a29f1c1a6e79109bf86fba379b3f3/examples/run_agent.py) currently selects external agent CLIs; it has no Pocket native provider. A phone-to-host inference/evaluation bridge is additional work if the physical phone is to drive the host workloads.

Keep benchmark execution on the dedicated Linux host/isolated worker described by the existing boundary. The phone retains useful offline inference and local companion tests. The optional host benchmark does not need to become an always-on network requirement for the product. Pin task IDs, image digests, model profiles, tool budgets and actual execution locations so a host-run model cannot be reported as a phone-run result.

Upstream defaults do not by themselves implement Pocket's boundary: its [configuration](https://github.com/sunblaze-ucb/exploitgym/blob/a8029e47135a29f1c1a6e79109bf86fba379b3f3/src/cybergym/evaluation/types.py) defaults the firewall off, and missing [resource limits](https://github.com/sunblaze-ucb/exploitgym/blob/a8029e47135a29f1c1a6e79109bf86fba379b3f3/src/cybergym/evaluation/base.py) leave Docker defaults. The adapter must supply and verify the approved isolation/resource/network profile and permitted task families.

Preserve upstream scoring: **`flag_captured`** and **`on_target`** are distinct. Capturing an expected flag does not by itself establish causal use of the intended vulnerability. Keep judge identity, trajectory evidence and all actual model usage explicit. See the pinned [submission contract](https://github.com/sunblaze-ucb/exploitgym/blob/a8029e47135a29f1c1a6e79109bf86fba379b3f3/docs/submission.md) and [scorer documentation](https://github.com/sunblaze-ucb/exploitgym/blob/a8029e47135a29f1c1a6e79109bf86fba379b3f3/agent_scorer/README.md).

## 6. What the failed calibration establishes

The [preserved PR #234 evidence](https://github.com/macksteward59-lgtm/pocket-ai-lab/tree/fce676c113cd95b7e6639c3c988088a6cdaa64d2/docs/evidence/recipient-format-calibration/44777249548) remains unchanged. General CI passed, while the separate format gate failed. The experiment used SmolLM2-135M-Instruct Q4_K_M, four generated tokens, 512 context and temperature zero.

| Frozen outcome | Raw | Chat formatted |
|---|---:|---:|
| Attempts | 36 | 36 |
| Text returns | 32 | 36 |
| Errors | 4 | 0 |
| Strict A/B answers | 0/36 | 0/36 |
| Correct / absent / counterfactual scores | 0/12 each | 0/12 each |
| Intended switches | 0/12 | 0/12 |

The separate vocabulary-only preflight verified frozen prompt token sequences and exact detokenization under the pinned library; it did not instrument the production generation invocation. The chat-formatted arm returned text in 36/36 attempts versus 32/36 raw; this arm bundles framing and the default system message, so the comparison does not isolate their individual effects. Neither arm satisfied answer format or demonstrated useful private-fact dependence. The 24 present-message chat outputs repeated the B-option text, and changed-fact pairs did not switch. That diagnostic observation is not a rescore. The causes of the four raw generation errors remain unproven.

This establishes failure under that exact model and protocol. It does not prove every larger model will fail, and it does not establish that changing weights alone will repair every runtime issue. A same-artifact reference/native comparison remains necessary. Reusing a four-token cap for a new thinking-only model could conflate incomplete reasoning or an unfinished response protocol with task failure; the new protocol must provide a declared, adequate and bounded completion budget. Record generated token counts and finish reasons to distinguish exhaustion, early end-of-generation and other outcomes.

## 7. Honest qualification sequence

These are proposed implementation stages. Freeze the actual cases, counts, thresholds, profiles and resource budgets before collecting acceptance outputs.

1. **Establish the invocation contract.** Verify the same exact GGUF in a reference invocation and Pocket at the pinned runtime. Compare rendered bytes, token IDs, sampler/mode, stop behavior, completion and error handling. Preserve the existing negative experiment. A reference failure and a native-only failure imply different next actions.
2. **Publish a new candidate experiment manifest.** Pin model and template revisions, digest, quantization, license, task versions, parser, sampling, seeds/repeats, context/output/time budgets and selection policy. Use model-correct settings declared in advance. If settings differ, report that the comparison is of model-plus-profile, not an isolated weight-only causal experiment.
3. **Test format and task behavior separately.** Include basic echo/extraction, A/B label mapping, balanced option orders, message absence, changed facts, distractors and unseen held-out cases. Count invalid, exhausted and failed attempts. For a new absence test, an explicit UNKNOWN response can be specified in advance; do not reinterpret the frozen absent score or require guessing a hidden fact.
4. **Test tools, coding and agent handoffs.** Check exact tool name/argument schema and deterministic code results, then sequential role handoffs. A syntactically valid tool call is not proof that the tool choice is useful or authorized. Keep role count separate from independent assessment: several prompts over the same model do not create an independent validator.
5. **Measure the physical iPhone envelope.** Begin with the current 2,048 context. Record cold/warm load, first-token and complete-answer latency, peak process memory, available memory, sustained sequential use, thermal/battery behavior, cancellation, unload and recovery. Only expand toward 4K/8K after observed headroom and quality justify it. Count the cost of reasoning tokens even when the visible final answer is short.
6. **Run a separately identified ExploitGym evaluation after the adapter is ready.** Fix the approved task set, images, environment, allowed information/tools, budgets and retry policy. Preserve all unsuccessful tasks in the denominator and both upstream scoring fields. Keep expected flags, grading answers and unrelated solutions outside candidate context. Local format/fact tests remain companion Pocket suites.
7. **Review and then decide promotion.** Use the existing registry/router, native evidence journal and improvement assessor. A candidate descriptor or supplied benchmark score does not load, authorize or promote a model. Reserve unseen final cases after development selection. Record genuine limitations and keep the model replaceable.

Useful existing components: [ModelSource](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873/packages/intelligence/model-registry/ModelSource.ts), [ModelPluginManager](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873/packages/intelligence/model-registry/ModelPluginManager.ts), [ModelRouter](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873/packages/intelligence/model-router/ModelRouter.ts), [ImprovementEngine](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873/packages/intelligence/evaluation/ImprovementEngine.ts), [native evaluation semantics](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/docs/architecture/Native-Self-Evaluation-and-Evidence-Journal.md).

## 8. Evidence limits and handoff

This research used publisher model cards and licenses, Hugging Face artifact listings/pointers, exact repository source, llama.cpp source and Apple documentation. Vendor benchmark tables were used to identify plausible candidates; different harnesses, precision, reasoning budgets and scaffolds prevent a reliable cross-card performance ranking. None of the retrieved sources proves that a selected Q4 artifact passes Pocket's native tests on the target phone, or succeeds in a separately authorized host-side ExploitGym evaluation with its actual inference location and configuration recorded.

The immediate engineering handoff is a **versioned native model-profile and reference-comparison experiment**, starting with Granite for ordinary text and retaining MiniCPM as a distinct numerical-path candidate. Keep the existing ExploitGym restoration and implement its missing adapter under the established host boundary. This document changes no runtime, frozen gate, authority, model installation, PR merge or device-acceptance status.

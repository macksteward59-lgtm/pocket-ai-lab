# Native recipient integration checkpoint after format calibration

Source reviewed: `6a61281a1d28a6b8ee1a292c74f8515c2250d110`, draft [PR #234](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/234).
This is a source/evidence handoff, not a new implementation or an authorization decision.

## Current behavioral result

[Run 44777249548](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44777249548)
completed all 72 frozen raw/chat requests. Input tokenization, native build, seven
fixture tests, measurement integrity and cleanup passed. The separate chat-format
gate failed: raw had 32 malformed text returns and four generation errors; chat
had 36 malformed text returns and no generation errors. Strict valid A/B answers
were zero in both formats, with 0/12 in each correct, absent and counterfactual
condition. The chat outputs were exactly twelve each of `B: maple`, `B: cedar`
and `No stored word is`. None was reinterpreted as an accepted answer.

Vocabulary-only tokenization of all frozen prompts under the pinned library is
now empirically verified; the production generation invocation was not
instrumented. Useful recipient behavior under this benchmark remains
unestablished. The observed outputs differed between arms, and chat recorded no
generation errors while raw recorded four in this paired run. That observation
does not establish a general error reduction, isolated causal mechanism or a
viable text baseline. Both original v1 runs and the new frozen experiment retain
their negative acceptance results.

## Reuse existing implementation

| Existing surface | What it supplies |
| --- | --- |
| [NativeGIECaptureEncoder.swift](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/runtime/ios/Sources/PocketLlamaEngine/NativeGIECaptureEncoder.swift) | Verifies codebook/model/bounds, calls the existing native sequence-capture runtime, and encodes GIE1. Caller-supplied captures retain a fixture/other-provider distinction. |
| [NativeGIECodebookArtifact.swift](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/runtime/ios/Sources/PocketLlamaEngine/NativeGIECodebookArtifact.swift) and [NativeGIESequenceCodec.swift](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/runtime/ios/Sources/PocketLlamaEngine/NativeGIESequenceCodec.swift) | Verify GCB1 identity and decode GIE1 into ordered segment spans and reconstructed pooled vectors. The decoder explicitly does not reconstruct individual token states. |
| [NativeInputEmbedding.swift](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/runtime/ios/Sources/PocketLlamaEngine/NativeInputEmbedding.swift) and [NativeInferenceRuntime.swift](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/runtime/ios/Sources/PocketLlamaEngine/NativeInferenceRuntime.swift) | Query live recipient capabilities and evaluate bounded first-layer input rows through the existing exact lease, scheduler, validation and cancellation drain. |
| [pocket_llama.c](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/runtime/ios/Sources/LlamaCppBridge/pocket_llama.c) | Evaluates the numerical rows and returns final-position vocabulary logits. It clears context before and after that operation. |

These components should not be reimplemented as a second inference engine or a
second orchestration/approval system.

## Remaining integration gaps

**Representation mapping:** no learned, validated mapping currently connects
decoded pooled final-layer GIE vectors and their spans to recipient first-layer
input rows. Matching model identifiers or widths does not establish compatibility.
Repeating a pooled vector for its span would not restore the lost token states.
Any candidate must bind exact producer/recipient revisions, verified codebook and
mapping-artifact digests, representation semantics and resource bounds.

**Conditioned recipient operation:** the current numerical API begins at position
zero, accepts no text question/suffix, returns logits and clears its context. A
subsequent ordinary text generation does not continue from those numerical rows.
A task-level experiment therefore needs an explicit, bounded operation combining
the mapped message with its question/instructions and any continuation.

**Transport and host integration:** [NativeLatentChannel.swift](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/6a61281a1d28a6b8ee1a292c74f8515c2250d110/runtime/ios/Sources/PocketLlamaEngine/NativeLatentChannel.swift)
still instantiates its affine-int8 single-vector codec. It is not already a GIE1
sequence receiver, and the native coordinator does not route a GIE payload into
the numerical evaluation API. Existing authorization/blob/replay abstractions
are reusable boundaries; demonstration adapters do not establish production
APEX/Director authority, durable replay handling or protected persistence.

## Next bounded work

The behavioral priority is a separately specified diagnostic for recipient
instruction compliance and use of the supplied fact. Any changed prompt, output
budget, parser, model or acceptance interpretation must be versioned and committed
before new outputs are observed. Do not relax the current parser or silently
replace the failed run. A new diagnostic should keep format validity separate
from factual use and retain an absent-message control and intended answer-switch
test where applicable.

An independent engineering increment can define an unavailable-by-default
mapping-candidate contract and composition adapter. It should reuse the verified
codebook loader/GIE decoder and live recipient-capability checks, require an
explicit mapping implementation, enforce artifact/model/representation binding,
and delegate numerical evaluation to the existing runtime. Synthetic mapper
fixtures can establish rejection, bounds and lifecycle behavior; they cannot
establish semantic compatibility. There must be no identity, padding or repeated
segment conversion silently supplied as a usable learned mapper.

Useful text behavior, a validated learned mapping, conditioned recipient
execution, host authorization, and physical iPhone acceptance remain separate
gates. The current diagnostic result does not authorize a production latent route
or promote any model/adapter.

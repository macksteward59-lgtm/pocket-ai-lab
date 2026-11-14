# Mobile Intelligence Competitive Gap Analysis — 2026-11-14

## Purpose

Use PocketPal AI as a concrete on-device GGUF product baseline. This is a capability-gap analysis, not a claim that Pocket AI Lab is faster, safer, more capable, or more private in practice. All comparisons must be measured on the same physical device, model artifact, settings, and software versions.

## Competitor capabilities observed

The official PocketPal repository and App Store release notes describe a substantially mature mobile inference product:

- Offline GGUF chat across models such as Gemma, Qwen, Phi, and Llama.
- Model discovery/download through Hugging Face, including gated models with a user-provided token.
- Per-assistant personas ("Pals") with model and system-prompt configuration.
- Built-in tool loops for selected tools such as calculator, date/time, HTML rendering, and optional web search/page reading.
- Voice input through on-device Whisper.
- On-device speech output using neural TTS engines including Kokoro, Kitten, Supertonic, and Phonon on supported devices.
- Hardware acceleration through CPU and GPU paths, Metal on iOS, and selected NPU paths.
- Token-speed and memory benchmarking, with optional sharing to a community leaderboard.
- Remote llama.cpp/OpenAI-compatible server support, context/capability discovery, and warnings around context limits.
- Speculative decoding support is listed as experimental.

Sources:
- Official project and current feature/architecture overview: https://github.com/a-ghorbani/pocketpal-ai
- Official App Store listing and version history: https://apps.apple.com/us/app/pocketpal-ai/id6502579498
- Official project website: https://www.pocketpal.dev/about

The App Store's regional listings and version-history snapshots can differ. Record the actual version/build installed on the test device instead of relying on a single storefront snapshot.

## Pocket AI Lab state in this branch

The current native app is an early functional foundation, not a PocketPal-equivalent product:

| Capability | Current state | Evidence / limitation |
|---|---|---|
| Native GGUF inference | llama.cpp + Metal backend is linked in the native engine package | Hosted device/simulator builds prove compile/link only; no physical iPhone run claimed |
| Model import | File-based GGUF import, with staged replacement and GGUF magic validation in PR #84 | No in-app Hugging Face catalog/download; full GGUF parsing is delegated to llama.cpp |
| Local chat | Basic SwiftUI chat path | Conversation history is currently in-memory; no durable chat database/export/import |
| Agent Team | Six sequential logical roles sharing one local model session in PR #85 | Not six independent models, no model pool, no tool execution, no persistent message bus |
| Runtime trust | Explicitly displayed as Unverified in PR #82 | Proof verifier primitive in PR #83 is not provisioned or wired into the app |
| Workspace | HTTPS WebKit workspace with loopback HTTP for local development | Server authentication/authorization remain server responsibilities |
| Context management | Fixed native context descriptor and bounded Agent Team prompt sizes | No tokenizer-aware context meter or adaptive context budgeting |
| Model routing | TypeScript model registry/router exists | Native app does not yet have a device-aware multi-model pool or reservation bridge |
| Voice | Not implemented in the native app | No on-device speech recognition or TTS integration |
| Benchmarks | Hosted build/test workflows exist | No physical-device tokens/sec, memory, thermal, or battery dataset |
| Tools | Existing APEX/East governance architecture | No native model-driven tool loop; model output cannot invoke tools |

## Strategic position

PocketPal demonstrates that offline chat alone is not a differentiator. A credible Pocket AI Lab advantage must combine useful on-device capabilities with stronger governance, trustworthy runtime state, and coordinated work that remains bounded and auditable.

Potential differentiation:
- APEX/Director and East/e3 as independent governance and durable workflow layers.
- Clear separation of model output, runtime attestation, authorization, and signed evidence.
- Multi-role collaboration with explicit provenance and critic/validator stages.
- A model-independent architecture that can use on-device models first and optional remote providers only with user consent.

These are architectural intentions until the corresponding native flows are integrated, tested, and accepted on-device.

## Recommended roadmap and trade-offs

### Priority 1 — Finish a reliable native foundation

1. Complete PRs #82–#85 and keep runtime trust visibly Unverified until a real trust service is provisioned and integrated.
2. Finish robust import, model/session lifecycle, chat persistence, export, and context-aware generation.
3. Add a native model inventory with exact file SHA-256, size, quantization, context metadata, source, and license provenance.
4. Add model-size and memory-pressure checks before load; unload only after active requests drain.

**Benefit:** dependable core behavior and recoverable local state.

**Risk:** persistent model files and chat history increase privacy and data-at-rest responsibilities. Provide explicit deletion/export controls and avoid collecting telemetry by default.

### Priority 2 — Device-aware model management and routing

1. Add opt-in Hugging Face discovery/download with a user-supplied token stored in Keychain, never source control or app logs.
2. Verify downloaded artifacts against published checksums where available and preserve license/source metadata.
3. Estimate memory from actual model metadata where possible; treat estimates as advisory until device measurements exist.
4. Introduce a native model pool and per-role routing only after exact session accounting, memory reservations, cancellation, and unload semantics are tested.
5. Keep a CPU fallback path if Metal is unavailable; never label a backend ready until the runtime probe and actual load succeed.

**Benefit:** flexible local models and more capable multi-agent collaboration.

**Risk:** parallel models can exhaust device memory and increase heat/battery drain. Start with sequential routing and strict reservations; do not equate multiple role prompts with independent models.

### Priority 3 — Voice and multimodal workflows

1. Evaluate on-device Whisper-compatible speech input.
2. Evaluate a compact local TTS engine with explicit model-size, language, and license choices.
3. Add vision only after image preprocessing, model compatibility, privacy boundaries, and memory budgets are validated.

**Benefit:** a more useful mobile companion and accessible hands-free workflows.

**Risk:** voice and vision models compete with the language model for memory, storage, thermal headroom, and battery. Treat them as optional capabilities that can unload independently.

### Priority 4 — Governed tools and optional connectivity

1. Tool requests must be typed proposals, never arbitrary model-generated executable code.
2. Route consequential actions through the existing APEX exact-scope approval and East workflow path.
3. Require user opt-in before web search, remote model routing, or sending user content off-device.
4. Keep local-only behavior functional when offline and disclose when a request requires connectivity.

**Benefit:** real agentic utility without surrendering user control.

**Risk:** tool adapters, web retrieval, and remote endpoints create prompt-injection, data disclosure, and authorization risks. No provider response can mint a receipt or approve its own action.

### Priority 5 — Measure before claiming superiority

Run a controlled comparison on the same iPhone Air and iOS build, using the same GGUF SHA-256, quantization, context, prompt template, temperature, token limit, and fixed prompt set. Measure:
- model import and cold/warm load duration;
- prompt processing and generation tokens/second;
- peak resident memory and memory-pressure events;
- thermal state and battery delta during sustained use;
- crash rate and stale-session behavior;
- blinded response-quality and safety rubric.

Pocket AI Lab should not claim a performance or quality advantage unless raw measurements, configuration, and reproducible test artifacts support it. See `ios/PRIVATE-IPHONE-TESTING.md`.

## Non-negotiable invariants

- llama.cpp and model output produce tokens/proposals only.
- Runtime readiness requires a separately trusted, model-file-bound, expiring proof; app labels and successful generation are not attestation.
- APEX/Director owns approval; East/e3 owns durable authorized workflow execution.
- ExploitGym remains isolated evaluation infrastructure; submitted source is never executed by static analyzers.
- BridgeGate, RuntimeController, LlamaEngine, and Evidence retain their established trust boundaries.
- No model, role label, memory record, or provider response can grant permissions, authorize actions, or issue trusted receipts.

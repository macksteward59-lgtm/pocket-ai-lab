# Pocket AI Lab — Unified Provider-Backed Agent Proof

**Status:** Executable host-side integration candidate, not a completed native product acceptance.  
**Implementation:** `scripts/desktop/unified-agent-proof.mjs`  
**Tests:** `scripts/desktop/unified-agent-proof.test.mjs`  
**Architecture:** Existing `Orchestrator` → `ModelRouter` → `LlamaCppInferenceProvider` → `MessageBus` → `MemoryManager`.

## Purpose and non-duplication

This proof targets a specific missing acceptance requirement in the **one Pocket AI Lab product**: showing that a configured provider is invoked for distinct agent roles, those invocations correspond to a validated message thread, and the Director's output creates only unverified episodic memory. It uses the existing intelligence engine, llama.cpp adapter, core-role registry, and conservative governance defaults. It does not create an alternative planner, policy engine, native model runtime, persistence store, or message format.

The existing local app proof `scripts/local-gguf/e2e-local.mjs` exercises loopback chat, memory APIs and the agent-task endpoint. This **complementary** proof inspects each invocation across the whole deliberation stage sequence and writes a machine-readable attempt-to-message record.

## What a successful run proves

With an actual reachable loopback llama-server and a compatible instruction-tuned model, one task performs seven separate **provider.generate calls**, in this exact order:

| Stage | Agent role | Resulting message |
|---|---|---|
| Independent | Reasoner | analysis |
| Independent | Researcher | analysis |
| Independent | Engineer | analysis |
| Cross-review | Critic | question |
| Cross-review | Validator | question |
| Verification | Validator | validation |
| Synthesis | Director | completion |

Each provider call must return structured output that the existing `MessageBus` accepts. The transcript must contain the same seven messages, with matching role/type/order. The existing `MemoryManager` must have **one unverified episodic record**, even if the model-generated Validator says that the reasoning was verified.

This is six **logical roles using one configured model**, not proof of six independently loaded models. Deliberation depth is set to zero challenge/revision rounds for the smallest bounded cross-role demonstration. The product's full deliberation engine supports longer cycles elsewhere; this harness does not replace it.

The report includes task ID, selected operator-configured model label, timestamps, stage/role linkage, response status and observed provider-call duration, hashes of transcript message payloads, the actual Director synthesis and a local SHA-256 over the report. The SHA-256 is **not** a cryptographic signature, trusted provenance, Evidence receipt, or an approval.

### Explicit nonclaims

- No iPhone execution, Apple signature, physical-device testing or on-device GGUF inference is established.
- `checkHealth()` and successful inference do not authenticate model artifact bytes or establish a trusted model revision; `requestedId` is an operator label.
- This is not durable East/e3 execution, production APEX authorization, external tool execution, or signed Evidence.
- The provided resource values are declared inputs, **not measured RAM or battery usage**.
- The seven provider calls are logical stage attempts. The llama.cpp adapter may make additional backend requests when repairing malformed output. This proof does not attest to HTTP request counts, model weights, or device resource availability.
- A positive model-generated validation message or an unkeyed report digest must never authorize a tool or mark memory verified.
- No G.I.R.L. latent route, cross-model alignment or receiving-model tensor ingestion is claimed.

## Run against a local model

Requirements: Node.js 22+, repository dependencies installed with `npm install`, and an already running **local** `llama-server` with a supported loaded GGUF model. Start the backend separately according to its documented installation and configuration. Do not expose the local server to a public network.

From the repository root:

```bash
POCKET_UNIFIED_POC=1 \
POCKET_POC_BASE_URL=http://127.0.0.1:8080 \
POCKET_POC_MODEL_ID=my-local-gguf \
POCKET_POC_MODEL_MEMORY_MB=1024 \
POCKET_POC_AVAILABLE_MEMORY_MB=2048 \
POCKET_POC_OBJECTIVE="Analyze a synthetic software design and identify risks without executing tools." \
POCKET_POC_OUTPUT=./unified-agent-proof.json \
node --import tsx scripts/desktop/unified-agent-proof.mjs
```

The memory numbers are example operator-declared ceilings, not asserted device measurements. Configure values for the actual host. `POCKET_POC_MODEL_ALIAS` is an optional alias passed to llama-server when needed. The backend URL must use a loopback hostname; non-loopback hosts and embedded URL credentials are rejected by this entry point. The output file uses exclusive creation and mode 0600; avoid committing it, as the report includes generated synthesis text that may be sensitive.

The CLI does not silently substitute a fixture response when the backend is absent. If the health check, resource route, model response schema, or message linkage fails, it exits non-zero without printing a fake successful proof. The existing llama.cpp adapter may attempt explicitly bounded repairs for invalid model JSON, but any remaining error fails closed.

### Deterministic CI check (NOT live inference)

```bash
npm install
node --import tsx --test scripts/desktop/unified-agent-proof.test.mjs
npm run test:desktop
npm run build
```

The deterministic test deliberately injects a test-double provider, and its `executionKind` is always `test-double`. It checks seven invocation/message pairs, stage context length, unverified memory, resource-denial, provider failure, and malformed output rejection. It cannot establish a live-model, native-device, authorization or memory-performance success.

These tests are automatically covered by the existing `Pocket AI Lab CI` on `codex/**` branches and main-targeting pull requests, via `npm test` / `test:desktop`. **No second, competing CI workflow is needed.**

## Integration into the full product

This harness is a disposable **acceptance probe**, not a production API. It should eventually be driven by a native iOS task in the established host composition root and extended only through independently reviewed PRs:

1. Reconcile native session ownership, readiness, cancellation and verified model artifact identity from the existing iOS/Director branch stack.
2. Bind the actual request and every provider step to durable East/e3 lifecycle events with preserved retries, interruptions and recovery.
3. Authenticate consequential operations via Director/APEX, never by agent messages or synthetic proof hashes. Preserve approvals and signed Evidence separately.
4. Integrate encrypted memory and real recipient-model participation (and optional G.I.R.L. only after trained, negotiated, evaluated semantics exist).
5. Verify the complete user-visible journey on the physical iPhone Air with measured memory, offline handling, restart and battery/thermal behavior.

**Decision gate:** Do not merge this branch based on synthetic CI alone and do not mark the global Pocket AI Lab master checklist verified. Real local-model logs, exact-head CI, integration review, and physical-device acceptance serve different purposes and must be reported separately.

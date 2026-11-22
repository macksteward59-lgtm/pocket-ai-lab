# Post-run causal review packet v1 — owned synthetic study only

## Purpose and non-overlap
Continuation of PR #277 and owner research issue #255. The original pinned Qwen2.5-1.5B result (0 TP, 1 FP, 1 FN, 4 TN) is unchanged. Its original artifact lacks enough information to identify the exact false-positive case independently. That original artifact cannot be retrospectively regraded from bytes that were never recorded.

This follow-on modifies only the existing post-run fixture export seam and runner output, adds a new offline reader, and runs synthetic controls. It does not rerun the model, alter its prompt, replace a failed model answer or authorize targets.

## Separation by phase
1. prepareCausalStudy creates random owned identities, actual loopback candidate/patched responses, host-only source mapping and public agent task.
2. runProviderOnce exposes only the public task. The private key is not accessible via exportPostRunCausalTruth until a scorable response finishes. Failed/time-out responses do not unlock it.
3. run-live.mjs now saves trial.json with the full public task, actual scored attempt and original raw model text, and SHA-256 of the separately written trial.json.answer-key.json, only after a scored model attempt. The key holds source mutation, case mapping, full synthetic HTTP records and oracle. Both outputs are written mode 0600 and fail if a file already exists.
4. Offline verify.mjs consumes the two files and independently regenerates prompt SHA, response SHA, differential oracle, witness hashes, public-to-private case mapping, request counts and source-aware TP/FP/FN/TN metrics. It does not call the original scorer WeakMap or a model API.

Usage:
    node tools/security-evaluation/causal-postrun-review-v1/verify.mjs trial.json trial.json.answer-key.json

Tests:
    node --test tools/security-evaluation/causal-counterfactual-v1/protocol.test.mjs tools/security-evaluation/pinned-causal-inference-v1/adapter.test.mjs tools/security-evaluation/causal-postrun-review-v1/verify.test.mjs tools/security-evaluation/causal-postrun-review-v1/write.test.mjs

## Trust and disclosure caveats
- The key is separately disclosed after inference, not encrypted and not signed. SHA-256 catches ordinary partial alteration but cannot prevent substitution of both unsigned files. This is neither source-independent proof nor verified runtime attestation.
- The key contains synthetic source truth and must never be sent to the model. Once disclosed, these public templates are no longer unseen test cases.
- The local HTTP fixture uses mock identity headers, not production authentication.
- The verifier checks supplied bytes and source-oracle invariants. It cannot establish that GitHub, a particular model, or a physical iPhone originated those bytes. External signatures, trusted review identity and immutable archival are future gates.
- Tests use synthetic loopback HTTP and injected test doubles: no new real Qwen inference, private unseen benchmark or external target.
- No APEX authorization, East recovery, ExploitGym production isolation, human review, physical iPhone, original M01–M42 permission mapping, RLS v3.12 acceptance, deployment or merge.

## Next gate
Review separately disclosed post-run key, then devise independently retained curator-private cases and human adjudication before any generalization claims. Preserve the original negative experiment unchanged.

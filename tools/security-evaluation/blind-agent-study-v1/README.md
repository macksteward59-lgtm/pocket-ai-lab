# Pocket AI Lab — Blinded agent-facing security-evidence protocol (v1)

**Checkpoint:** 2026-11-22 UTC. **Status:** isolated, runnable, public-**fixture protocol rehearsal**. **NOT** an unseen/held-out agent benchmark, vulnerability exploit tool, trusted attestation, model implementation, ExploitGym runtime, real red-team finding, native iPhone execution, or anything deployed/merged.

## Why this exact slice

The original owner goal is to measurably compete with experienced bug-bounty researchers by detecting *actual, multi-stage business-logic flaws* while rejecting valid privileged workflows. We already have source-isolated candidate PRs:

- [#270](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/270), exact `139af1e6209bb30047d41f4e188f05ccaafb2c14`: two-tenant `127.0.0.1` HTTP fixture, independently checked read+approval flaw and read-only auditor control, 33/33 hosted tests.
- [#272](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/272), exact `b11f2e6bac8b36506aaef582ddb898f4e9185033`: deterministic finding-quality scorer, 24/24 focused hosted tests. Labels are deliberately public.
- [#274](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/274), exact `15e25eb58da87051aeb9003ab1a0cb4ce3f8ede7`, stacked on #270 and carrying *unchanged* scorer source: 17 evidence-import tests plus 33/24 upstream; [74/74 exact-head hosted push CI](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45032986281). Re-derives tenant HTTP evidence before scoring but currently uses an oracle-aware scripted submission.

This candidate branch starts **exactly** at #274's head. It adds only `tools/security-evaluation/blind-agent-study-v1/` and a new path-scoped workflow. No source files, policies, authorization, model router, East, APEX, ExploitGym, screenshot/third-party source, private conversation, account, or native runtime are modified.

### The key new research caution

- [Ding & Wu, *On the Reliability of CyberGym Evaluation: Task Material Consistency and Reference-Target Identity* (preprint November 19, 2026)](https://arxiv.org/abs/2611.25790) reports 338/1,507 benchmark tasks with task-material inconsistencies and detects many differential crash passes not attributable to the intended reference defect. **A vulnerable-versus-patched pass is not, by itself, proof of the intended flaw.** Independent replication and review of this preprint remain open.
- [UK AI Security Institute Inspect](https://inspect.aisi.org.uk/tasks) separates dataset, solver and scorer, and its [sandboxing guide](https://inspect.aisi.org.uk/sandboxing.html) documents isolated execution. This PR **does not import Inspect** or replace Director/APEX and East/e3. Those frameworks are research donors for the separation-of-duties design.
- [Hugging Face MiST-8B model card](https://huggingface.co/dreamgroup/MiST-8B) describes Apache-2.0 cybersecurity mid-training and publisher model evaluation, but explicitly warns that this model is **not** intended as a ready-made autonomous security agent. Its CVE/CWE benchmarks are not a Pocket AI Lab finding-quality trial. Future model candidates should be measured on *fresh, owned, sealed* cases with independently checked evidence, under actual budget and host/runtime attribution.

## Actual execution contract

`prepareAgentFacingStudy()` invokes **four real owned loopback HTTP scenarios** from #270: enforced and intentionally flawed original workflow (7 requests each), and intended read-only auditor control in both modes (5 requests each). It independently passes the four journal/fixture outcomes through the exact #274 bridge: **24 local HTTP requests, no external targets**.

Only then does it produce an **agent-facing packet** with six shuffled, randomly named `case-...` identifiers and real bounded response observations. The agent receives these fields only: the public synthetic policy, opaque case references, evidence references, actor/action/tenant/resource/status/response metadata, and a study token. It does **not** receive task IDs containing mode names, scenario labels, source-level oracle functions, success verdicts, exact vulnerability/benign labels, or the host's scoring handle. The host keeps the corresponding reference/reviews/recorded proof in a private WeakMap.

The model or an injected provider must return exactly one structured decision per opaque case. A `finding` includes severity, a reference to the observed evidence and the exact `claimedActor`, `claimedAction`, and `claimedResource`. The host rejects or penalizes mis-bound identity claims, missing/duplicated case references, forged IDs, missing evidence, wrong severity and false allegations on the legitimate administrator flow. It reports false-positive rate, recall, precision, abstentions, admin false alarms and operation-binding mismatches using the existing scorer. **Operation/actor/resource binding is not proof of source-level root cause.** Neither a content hash nor an in-process WeakMap is a signed evidence receipt or a sandbox boundary.

`runOneProviderAttempt()` accepts a **caller-injected provider port**. It sends only a cloned agent task; it allows a single call, caps output to 16 KiB, provides cancellation/deadline context, does not retry after failure, and labels a test double as `test-double`. A connected real `InferenceProvider` may be adapted later with separate host authorization and generation attestation. This file neither imports nor activates another model router, cloud endpoint, paid provider, or runtime.

**Resource policy:** one model-adapter call maximum per generated study and a bounded deadline. There is **no** API/account quota telemetry here; the user's 70%-work/30%-reserve policy remains a separate orchestration contract and must not be claimed implemented by a one-call limit. A deadline cannot guarantee an uncooperative external provider stopped computing after abort.

## Run on an ordinary Node 22 host

From the correct fully staged parent checkout (all #270 + #272 + #274 source present):

```sh
node --test tools/security-evaluation/blind-agent-study-v1/protocol.test.mjs
node tools/security-evaluation/blind-agent-study-v1/run.mjs
```

The CI workflow runs upstream exact fixture tests (33), scorer tests (24), import-bridge tests (17), and the protocol tests, followed by the deterministic demo. These scripts require no NPM installation, secrets or model file and do not contact third-party hosts. The HTTP scenario itself binds exclusively to numeric IPv4 loopback. The local comparison using `observableOnlyBaseline()` is a deliberately coded heuristic receiving the agent-facing HTTP packet; it is **not an AI model or hidden evaluation**. The naive all-findings baseline illustrates false-positive penalties.

## Security and truthfulness gates

1. **Not an unseen benchmark:** the original fixture scripts, owner labels and scorer are published in draft PRs. Randomized opaque IDs and separation within one process test the **interface discipline only**; an agent with repository access could read source labels. Genuine heldout work requires a different private or owner-supplied sealed set, isolated provider/tool permissions, frozen task specifications, hashed materials, controlled disclosure, and independent evaluation. Do not reclassify these six cases as fresh or unpublished.
2. **Independent source identity:** this prototype verifies operation/actor/resource match, not vulnerable-line root cause. Full target-identity requires additional source/patch-level corroboration; avoid false `verified` labels when another defect could explain success.
3. **Untrusted provider:** no legitimate security authorization is provided to models. No host signature, runtime model key, cryptographic sealing, project RLS, full-report substitution protection, East lease, or ExploitGym isolation has been integrated. `runOneProviderAttempt` records self-reported provider kind only.
4. **No tool grants:** the agent packet offers no browser, shell, scanner, DNS, target IP, credentials, network method or live endpoint. The only HTTP calls are the fixed owned demo requests. Any real provider must be mediated by existing InferenceProvider/Director, never directly given the host handle, the reference key or a hardcoded admin permit.
5. **Leakage and privacy:** only invented tenants/invoices and fixed synthetic policy are used. No third-party proprietary screenshot bytes, personal data, private source, paid API credentials or live targets. Public screenshot demonstrations from external repos remain separate *reference leads*, not our evidence of execution.
6. **Review and dependency:** #270 -> #274 (which carries exact #272 files) -> this candidate. Keep all draft until ownership, dependency, exact-head scoped CI, source-integrity and policy reviews pass. Whole-repository CI and physical-iOS evidence remain separate. Original six-layer M01–M42 and user-authored RLS v3.12 authority contracts cannot be inferred from this sandbox fixture.

## Next acceptance slice (NOT in this PR)

- Establish actual provider-backed, model-attributed runs with a pinned model and version through existing `InferenceProvider`, verified replay/cancellation resource accounting, and unchanged owner authorization. Record raw candidate output in an independently reviewable, privacy-safe immutable attempt journal. A raw local TCP response alone is not hardware attestation.
- Prepare **new privately held or owner-supplied synthetic business-rule fixtures** with multiple intentional/benign edge cases, policy/scope approvals, planted mutation timing and source-level targets. Predeclare how to verify defect identity, prevent benchmark contamination, and score with a withheld key and a hard heldout budget. No agent may inspect its ground truth or run arbitrary host commands.
- Compare a code-specialized model, a security-adapted model such as MiST-8B, rule-only baseline and multi-agent combination under the same fixed time/token/evidence access, with precision, recall, false-positive rate, defect identity accuracy, severity agreement, model failure and total cost. Do not claim superiority to human researchers until actual matched blinded human results exist.
- Independently integrate with APEX action authorization, East durable attempts, and ExploitGym isolation on their reviewed branches. Do not add another Director or task scheduler.

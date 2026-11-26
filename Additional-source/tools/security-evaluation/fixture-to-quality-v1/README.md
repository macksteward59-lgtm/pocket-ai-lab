# Pocket AI Lab — Actual owned-fixture observations to finding-quality scoring

**Status:** Candidate integration, synthetic lab only; draft and unmerged. **Created:** 2026-11-22 UTC.

**Purpose:** Join the two independently developed *existing* Pocket AI Lab test branches into one verifiable **local-only** evidence-to-score path, without replacing Director/APEX, East/e3, ExploitGym, the model-independent InferenceProvider or the prior scorer.

## Verified upstream branch sources and intentional assembly

- [PR #270](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/270), head `139af1e6209bb30047d41f4e188f05ccaafb2c14`, implements local 127.0.0.1 tenant HTTP fixture, test client, independent `assessRecordedSequence` and `assessAuditSequence`, and SHA-256 self-consistency journals. Its focused CI earlier passed 33 tests. This new branch **starts at that head**; source files are left untouched.
- [PR #272](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/272), head `b11f2e6bac8b36506aaef582ddb898f4e9185033`, implements the independent smoke reference, input validation, deterministic finding-quality metrics and 24 tests. This branch **stages exact, byte-identical copies of the five unmodified scorer files** as a temporary integration base. It does not change PR #272 or silently merge it into `main`.
- [PR #267](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/267) provides publicly documented visual-evidence research; the present slice uses **no screenshots, leaked material, browser automation or model inference**.
- Follow existing [owner research issue #255](https://github.com/macksteward59-lgtm/pocket-ai-lab/issues/255) and coordination protocol. Release depends on review and eventual reconciliation of these two draft upstream PRs, not just a passing integration CI run.

## One actually observed local trial

`runOwnedFixtureQualityStudy()` runs **four separate, real loopback HTTP scenarios**, obtains in-memory journals and final resource states, and checks them **again** rather than trusting self-reported summaries:

| Runtime scenario | Requests | Expected result | What independent oracle validates |
| --- | ---: | --- | --- |
| Enforced two-tenant invoice workflow | 7 | No defect | Unauthorized cross-tenant read+approval denied; owner state remains unchanged |
| Intentionally flawed invoice workflow | 7 | Two synthetic authorization defects | Cross-tenant read and approval actually succeed, owner observes state mutation |
| Enforced read-only auditor workflow | 5 | No defect | Legitimate administrator can read across tenants but cannot mutate or impersonate |
| Flawed-mode read-only auditor workflow | 5 | No defect | The same *intentional* privilege remains legitimate even if unrelated tenant endpoint is flawed |

Total = **24 loopback HTTP requests** across four distinct task IDs. The importer independently re-runs the existing fixture oracles over the hashed event payloads, cross-checks status, modes, task IDs, request count, final beta-invoice state, exact execution-kind labels, and zero reported external targets. Any missing, conflicting, or corrupted fixture evidence aborts scoring.

It then associates six frozen, **publicly disclosed synthetic smoke** cases from the existing PR #272 scorer with the executed HTTP observations. Its administrator case was marked `planned-synthetic-control` in PR #272; **only after the actual administrator loopback runs pass**, the bridge's local copy of the reference marks this case `existing-owned-fixture`. It does **not** edit PR #272's reference file.

For each case, an observation ID is derived from a 64-hex digest of exact task/mode/journal/observation information. The **full digest** remains in the host-side receipt; the scorer's shorter stable ID is a key for matching a candidate's claim against the separate local review. This is **ordinary self-consistency only**; no external trust anchor, signer, protected observation store, agent identity proof, or independently authorized reviewer exists.

## Run — independent and scripted evidence controls

```bash
node --test tools/security-fixtures/tenant-workflow-v1/run.test.mjs tools/security-fixtures/tenant-workflow-v1/admin-control.test.mjs
node --test tools/security-evaluation/heldout-finding-quality-v1/score.test.mjs
node --test tools/security-evaluation/fixture-to-quality-v1/bridge.test.mjs
node tools/security-evaluation/fixture-to-quality-v1/run.mjs
```

Requires Node.js 22.16 or compatible Node 22, no `npm install`, no credentials and no host access outside `127.0.0.1`. Each synthetic server binds an ephemeral IPv4 loopback port and closes before the process exits.

**Demonstration baselines — explicitly scripted, NOT models or humans:**

| Script | True positives | False positives | Legitimate admin false alarms |
| --- | ---: | ---: | ---: |
| Known-oracle scripted control | 2 | 0 | 0 |
| Naive “everything is a vulnerability” | 2 | 4 | 1 |

These metrics show the evaluator and evidence bridge are internally consistent, not actual agent discovery quality. **The model must never see owner labels, independent reviewer statuses, or answer-generating baseline logic in a future blind trial.**

## Evidence boundary — what remains unproven

- A journal's SHA-256 chain can be recomputed by a fully privileged attacker. `hostSignatureVerified`, `reviewerIdentityVerified` and `fullReportSubstitutionResistance` are false. No signed hardware or runtime attestation was attempted.
- The scope of action is **owned synthetic fixture-only**. `x-fixture-*` headers simulate roles; they are not real user authentication, OAuth, program consent or an APEX authorization receipt.
- The rules and severity labels are known synthetic definitions, not a benchmark on real customers, real bounties, secret-held-out targets, human researchers or model-only inference.
- No protected source/data, external screenshot images, third-party vulnerabilities, outbound testing, production deployment, cloud model, iOS runtime, East recovery, ExploitGym task, or disclosure was used.
- `scoreFixtureClaims` only accepts an in-process issuer's evaluation packet. That is a process-local guard, **not** an interprocess cryptographic identity. The packet contains answers and must never be passed to a model during a blind study.
- PR #270's intentionally flawed HTTP server should **never be deployed publicly**. Tests do not establish host-enforced network egress across arbitrary user-controlled workloads; the client itself limits exact loopback requests.

## Next real evaluation, without claiming it occurred

1. Freeze a larger held-out set of owned/consented business logic workflows with *different* states and legitimate privileged controls, not merely slight variations of these six public cases. Store ground truth and pass/fail independent oracle with a separate trusted evaluator, **outside model-accessible context**.
2. Show the model only permitted environment description, bounded observations, source metadata and opaque evidence references. The candidate agent proposes findings, severity, reproducible observation IDs, and abstention as needed. It cannot choose target URLs, alter policy, read oracles, or self-approve network actions.
3. Use the **actual** existing Director/APEX authorization layer, East/e3 durable lineage and ExploitGym isolated scorer; independently validate with real host-bound verification and audit evidence. Compare against single-model, scripted scanner, non-agent deterministic and eventual matched human baselines. Track defect chains, FP/FN, intent-aware admin FP, token/cost and trace completeness.
4. Keep source-code licenses separate; this code does not import any external benchmark engine or model weights. Repair the known unrelated `main` East lifecycle import/build failures in their own owned branch; never hide them behind a scoped green result.

## Research cross-reference — proof-over-screenshot engineering

- [Stanford BountyBench](https://crfm.stanford.edu/2025/05/21/bountybench.html): real-world vulnerability tasks, patched/vulnerable states, executable verifiers and author-reviewed agent runs. **Borrow only the verified-state evaluation principle**, not the sometimes privileged agent container or third-party vulnerable systems.
- [NIST CAISI cyber evaluation tools](https://github.com/usnistgov/caisi-cyber-evals): Inspect AI integrations for CVE-Bench/Cybench/Pwn.College; prospective **external** evaluator adapter rather than replacement for East/e3.
- [Microsoft ACES](https://github.com/microsoft/ACESEvals): declarative YAML cyber tasks compiled to Inspect AI, useful for future frozen task manifests and reproducible scoring, not deployment proof.
- [Keygraph Shannon benchmark](https://github.com/KeygraphHQ/shannon/blob/main/docs/shannon-xbow-aikido-benchmark.md): public SARIF and paper comparisons; its publisher reported mistaking legitimate admin access for a vulnerability, motivating our intentionally benign privilege control. Publisher benchmark counts are **not** Pocket AI Lab verified performance. Shannon's main source license is AGPL-3.0; **no code borrowed**.
- [MiST-8B](https://huggingface.co/dreamgroup/MiST-8B): cybersecurity-specialized model as a possible external future trial, not an agent harness or known useful recipient in Pocket AI Lab. No weights downloaded; no model suitability claim.

**Next owner-facing checkpoint:** independently review the stacked branch and hosted logs; then integrate *actual agent-submitted predictions* on genuinely unseen owned cases under the existing authorization and evaluation contracts. Do not confuse fixture self-consistency, a scoreboard with revealed labels, or a screenshot with proven autonomous vulnerability detection.

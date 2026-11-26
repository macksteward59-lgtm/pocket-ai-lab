# Director Learning-to-Skill Integration — Design Note

**Status:** Design-only proposal; not an implementation or authorization change.  
**Date:** 2026-11-20  
**Base:** `fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873`  
**Branch:** `codex/director-learning-skill-bridge-design-20261120`

## Objective

Give the existing Director a governed way to discover capability gaps, develop versioned skills, evaluate demonstrated competency, and propose approved skills for assignment to existing agents. Reuse the existing skill lifecycle and registry rather than creating a second skill catalog or treating model fine-tuning as skill creation.

The current Agent Learning & Improvement work is a useful candidate-learning layer. It is not yet a complete skill-development system: its change kinds cover prompts, retrieval, routing, tool workflows, and adapter training, but it does not create a versioned `DevelopedSkill`, evaluate skill competency, or promote an approved skill into the active registry.

## Verified integration gaps

1. The in-flight Agent Learning branch adds an optional `AgentLearningTool` parameter to `DirectorCommandRouter`.
2. `createDirectorTaskRuntime.ts` still constructs the router with only `DirectorCapabilities` and `ToolDirector`; it does not inject the learning service.
3. `apps/web/directorRuntime.ts` does not construct or inject an `AgentLearningTool`. The local web Director therefore cannot use the new learning commands; the optional router dependency fails closed.
4. `LearningEvidence.contentDigest` is checked only for non-empty text. The tool does not recompute the digest from the returned content before recording it.
5. `propose-agent-learning` accepts a model-supplied `agentId` after only a non-empty-string check. It is not resolved against authenticated agent context or the registered agent catalog.
6. `validateBudget` enforces positive values and a minimum memory amount but no host-owned maximum runtime, memory, or output ceilings.
7. Proposals and candidates are held in process-local `Map` objects. They are lost on restart. Candidate results carry references but no required artifact digest or independently verifiable sandbox-run attestation.
8. The Agent Learning branch is stacked on the East integration branch and is currently divergent from its parent. It requires a parent refresh and exact-head CI before integration.

## Proposed architecture

### 1. Separate the four artifacts

- **Learning proposal:** a hypothesis about a skill gap or capability improvement, bound to a task and evidence.
- **Developed skill:** a non-executable, versioned knowledge artifact containing prerequisites, objectives, exercises, success criteria, source references, and competency requirements.
- **Skill evaluation:** an evidence-backed record of what an existing agent demonstrated against a specific skill version.
- **Tool artifact:** executable functionality, if needed by a skill. It remains a separate ToolDirector artifact and must use the ToolDirector's independent sandbox and approval lifecycle.

A skill must never grant itself tool permissions, device access, target authorization, or a new agent identity.

### 2. Extend the existing skill lifecycle

Use the existing skill registry/lifecycle concepts for these stages:

`proposed → researching → developing → evaluating → quarantined/approved → active → deprecated`

Persist immutable versions and digests. A promotion request must bind:

- skill ID and version;
- canonical skill-content digest;
- source evidence digests and review attestations;
- evaluation record IDs and competency results;
- intended existing specialist/core-agent assignments;
- evaluator identity and approval expiry.

The active registry exposes only the approved version. Rollback must create an auditable lifecycle event and must not erase prior versions.

### 3. Make evidence verifiable

The host evidence adapter remains the authority for whether a source is approved. In addition, the learning layer should:

- canonicalize the exact UTF-8 content representation;
- recompute SHA-256 locally and compare it with the adapter's digest;
- reject mismatches, duplicate source IDs, stale evidence, and missing retrieval metadata;
- preserve source URL, excerpt or content reference, retrieved time, review state, and confidence;
- treat source text as untrusted data, never as instructions to the Director.

A model-generated claim or a self-declared `reviewed` flag is not independent source verification.

### 4. Bind identity and competency to trusted context

Resolve the proposing agent from the host-authenticated task/session and registered agent catalog. Do not accept a free-form model-selected `agentId` as provenance.

Competency levels should be evidence-based (0–5). The evaluation input and stored record must include the achieved level, attempted/passed exercises, evidence references, rubric version/digest, evaluator, and timestamp. The evaluator must not be the same untrusted model whose claim is being assessed.

Assignments may reference only existing specialist/core-agent IDs. Skill assignment must not create agents or expand their permissions.

### 5. Enforce resource budgets at the host boundary

Model-proposed budgets are requests, not limits. Define host-owned maximums for runtime, memory, output bytes, dataset size, hyperparameter count/value size, and concurrent jobs. Reject or clamp requests before approval digest creation; the sandbox must independently enforce the same or stricter ceilings.

The string label `disposable-no-network` is not proof of isolation. A successful training result must include a host-verifiable run manifest with sandbox implementation/version, policy digest, network-egress result, resource limits actually enforced, start/end times, teardown result, and candidate artifact SHA-256. A missing or invalid manifest quarantines the candidate.

### 6. Persist state and make operations restart-safe

Replace process-local proposal/candidate maps with a host-injected durable store. Required properties:

- atomic writes and bounded record sizes;
- immutable version and evidence references;
- unique operation IDs and replay rejection;
- approval binding to the exact canonical job digest;
- restart recovery without repeating an uncertain external training attempt;
- append-only lifecycle events for proposal, approval, training, evaluation, promotion, rejection, and revocation.

Do not retry a training operation after an ambiguous timeout unless the host can prove the original attempt did not execute.

### 7. Wire the capability through one composition root

Add an optional learning-service port to `DirectorTaskRuntimeOptions` and pass it into `DirectorCommandRouter`. The web composition root may inject the service only when its required evidence, durable storage, approval, sandbox, and evaluation adapters are all configured.

If any required adapter is absent, the corresponding command remains unavailable or fails closed. Do not fabricate no-op approval or sandbox implementations to make the UI appear enabled.

The Director may autonomously propose and research a skill. Evaluation may run only in approved local/authorized training environments. Promotion to the active registry requires independent human approval bound to the exact skill version and evidence.

## Required adversarial tests

- evidence content/digest mismatch and stale-source rejection;
- malicious instructions embedded in source material;
- fake/unregistered agent IDs and cross-task proposal reuse;
- missing, expired, wrong-task, wrong-digest, and replayed approvals;
- runtime/memory/output budget overflow and oversized hyperparameters;
- sandbox manifest missing, forged, policy-mismatched, or teardown-failed;
- candidate artifact digest mismatch and candidate/baseline identity confusion;
- restart recovery, duplicate operation IDs, corrupted storage, and ambiguous training timeout;
- competency inflation, evaluator self-grading, stale rubric, and insufficient exercise evidence;
- assignment to unknown agents and attempted permission escalation;
- promotion, revocation, rollback, and proof that unapproved skills never enter the active registry.

## Integration order

1. Restore the mainline East lifecycle dependency and obtain exact-head CI for the current integration branch.
2. Refresh the Agent Learning branch onto the current East integration head; rerun exact-head CI.
3. Add evidence digest verification, trusted agent identity, and host-enforced budget ceilings.
4. Add durable proposal/candidate storage and signed sandbox-run/artifact manifests.
5. Add the skill artifact/evaluation adapters that reuse the existing skill lifecycle.
6. Inject the optional service through `createDirectorTaskRuntime` and the web composition root.
7. Run adversarial tests in a verified disposable sandbox.
8. Keep the PR draft until independent review, full CI, and human approval are complete.

## Current repository blockers

- Main is at `fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873`. Its latest full intelligence/consumer CI is still blocked by missing East lifecycle modules referenced from `packages/intelligence/__tests__/autonomy.test.ts`.
- The East integration PR supplies the missing modules, but its current head is 272 commits ahead and 4 behind main, is draft, and GitHub currently reports it as not mergeable. Its PR description's cited green validation SHA is older than its current head; no current-head status records were returned.
- The Agent Learning PR is 12 commits ahead and 9 behind its current parent branch, is draft, has no submitted reviews, and has no exact-head status records.
- No verified disposable, network-denied sandbox was available during this cycle. No generated tools or training jobs were executed.

## Non-goals

This design does not enable autonomous live-target testing, self-approval, self-grading, direct production model-weight mutation, automatic skill promotion, automatic permission grants, or direct device operations. Bug-bounty program eligibility is never an authorization to test a target.

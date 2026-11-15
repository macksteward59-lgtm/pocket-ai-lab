# Director Skill Lifecycle and Bug-Bounty Research Gates

**Status:** Design note only. No implementation, execution, target testing, or authorization change is implied.

**Repository baseline:** `main` at `818799eced634577c8f1760fa2bdd1f657bd8427`, inspected 2026-11-14.

## 1. Current verified state

### Lifecycle primitive added on a feature branch

This branch adds `packages/intelligence/skills/SkillLifecycle.ts` as a non-executable lifecycle/promotion primitive. It is not wired into Director commands, the operational SkillRegistry, ToolDirector, or any execution adapter.

- Skill artifacts are schema-versioned and SHA-256 digest-bound using canonical JSON.
- Artifact inputs require provenance, reviewed source state before promotion, bounded exercise definitions, safety boundaries, a rubric, and competency threshold.
- Evaluation records are digest-bound to one exact skill version; author self-evaluation is rejected.
- Promotion requires independent evaluation verification plus an injected authenticated human-approval verifier bound to the artifact, evaluation, and exact assignment-set digests.
- Lifecycle transitions are explicit; activation requires a verified promotion authorization matching the exact skill ID, version, and artifact digest.
- The verified promotion authorization is an immutable, process-local capability object. Freezing it prevents callers from mutating the evaluation or assignment digests after verification; it is not a durable approval record and must be re-verified after process restart.
- The module does not persist artifacts, evaluate generated code, activate skills in the operational registry, grant tools, or grant permissions. Host integration and durable storage remain separate future gates.
- Tests cover integrity tampering, stale approval, unreviewed sources, self-evaluation, missing evidence, verifier failure, and lifecycle transitions.

The existing operational skill catalog remains unchanged. A lifecycle status of `active` in this candidate manager is not yet consumed by Director or any agent runtime.

### Skills

- `packages/intelligence/skills/SkillRegistry.ts` is an in-memory registry of static skill records. It validates IDs, topics, and assignments against existing specialist and core-agent identities.
- `packages/intelligence/skills/catalog.ts` supplies the existing five-layer catalog.
- The registry describes knowledge only. It does not grant tools or permissions.
- There is no skill artifact store, version lifecycle, evidence-based competency evaluator, promotion gate, or performance tracker in the current `main` tree.
- `DirectorCapabilities`, `DirectorCommandRouter`, and `createDirectorTaskRuntime` have no skill-development commands or service ports.

### Tool workshop and host wiring

- `ToolDirector` already accepts injected builder, sandbox, artifact store, and approval verifier ports. It refuses development when the builder or isolated sandbox is missing. Activation requires an independent approval bound to the task, tool, version, and artifact digest.
- PR #87 merged `runtime/adapters/director/FileToolArtifactStore.ts` into `main`. It persists inert JSON, validates canonical SHA-256 digests, rejects unsafe paths/symlinks and broad POSIX permissions, and does not execute generated source. It is single-process storage and does not encrypt data at rest.
- `apps/web/directorRuntime.ts` currently constructs `ToolDirector` with only a `ToolRegistry`. It intentionally supplies no builder, sandbox, durable store, or approval verifier. Consequently, tool development/testing fails closed and the default artifact store is in-memory.
- `runtime/adapters/director/README.md` states that `LocalApprovalRegistry` is not wired into the local web runtime because there is no authenticated approval surface. The registry is a primitive, not a user-authentication or approval UI.

### Bug-bounty foundation

- The current `main` tree does not contain `packages/intelligence/bug-bounty/`.
- PR #42 contains a substantial non-executing program-policy intake, interpretation, review, normalization, and scope-evaluation foundation. It remains open and is 115 commits ahead / 400 commits behind current `main`; GitHub reports the branch as diverged and not mergeable. Its latest branch CI passed on 2026-11-13, but its visible Greptile 5/5 review is associated with an earlier head SHA, not the current PR head. Do not merge it as-is; selectively port and re-review against current `main`.
- The PR's policy/action boundary is intentionally fail-closed. Its current approach is structured intake, not a complete autonomous crawler or proof of authorization.

## 2. Skill artifact model

Keep skill content separate from executable tool artifacts. A skill is versioned, non-executable knowledge plus exercises and evidence.

Recommended record:

- Identity: `id`, `version`, `title`, `layer`, `description`.
- Knowledge: `knowledge`, `prerequisites`, `learningObjectives`.
- Exercises: `id`, objective, authorized environment type, success criteria, evidence required, and safety boundary.
- Provenance: source URL, source title, exact section/excerpt reference, retrieval timestamp, content hash, confidence, and review state.
- Assessment: evaluation rubric, minimum passing exercises, required competency level, and whether human review is required.
- Assignment: existing specialist IDs and/or existing core-agent IDs only.
- Integrity: canonical digest, previous digest, created/updated timestamps, and lifecycle status.

Suggested lifecycle:

`proposed -> researching -> drafted -> evaluating -> approved -> active -> deprecated`

Any failed integrity check, poisoned source, invalid exercise, or failed evaluation moves the candidate to `quarantined`. Only an approved active version is exposed through the operational `SkillRegistry`. Historical versions and evaluation records remain in a separate store.

Recommended competency scale:

| Level | Meaning | Evidence expectation |
|---:|---|---|
| 0 | Not learned | No evidence |
| 1 | Understands concepts | Accurate explanation against a rubric |
| 2 | Analyzes examples | Correct analysis of supplied cases |
| 3 | Supervised practice | Completed authorized lab exercises |
| 4 | Repeatable independent competency | Multiple reproducible evaluations |
| 5 | Can evaluate, teach, and improve the skill | Peer-quality assessment and validated improvements |

A model's self-rating is never competency evidence.

## 3. Director improvement workflow

1. **Gap analysis:** compare task requirements with active skills and recorded evaluations; distinguish missing knowledge from missing tools or permissions.
2. **Research:** gather authoritative sources through the existing research port. Treat page text, code examples, and embedded instructions as untrusted data.
3. **Draft:** produce a skill definition, objectives, exercises, rubrics, source references, and an explicit safety boundary.
4. **Evaluate:** test explanations and exercises using fixed cases and authorized training environments only. Generated code, if ever needed, belongs to a separate ToolDirector artifact and must pass its own isolated sandbox.
5. **Quarantine or approve:** failed, ambiguous, stale, or tampered candidates remain inactive. Human approval is bound to the exact skill ID, version, digest, evaluation digest, and intended assignments.
6. **Assign:** validate every owner against existing specialist/core-agent IDs. Do not create agents or widen permissions through skill assignment.
7. **Measure:** record task outcomes, evaluation evidence, source freshness, and regression results. Recommend revisions; do not silently replace active skills.

Suggested components:

- `SkillGapAnalyzer`
- `SkillResearcher`
- `SkillDeveloper`
- `SkillEvaluator`
- `SkillVersionManager`
- `SkillApprovalGate`
- `SkillAssignmentEngine`
- `SkillPerformanceTracker`

Suggested repository placement:

- `packages/intelligence/skills/`: schema, lifecycle manager, store contract, evaluation records, promotion logic.
- `packages/intelligence/director/`: injected skill-development ports and bounded commands.
- `packages/intelligence/__tests__/`: lifecycle, integrity, and adversarial tests.
- `docs/implementation/`: lifecycle and operator documentation.
- `apps/web/directorRuntime.ts`: host wiring only after a verified sandbox and authenticated approval surface exist.

## 4. Non-negotiable invariants

1. A skill never grants tool access, network access, device access, or operational permission.
2. Existing `ToolRegistry`, `DelegationGate`, APEX/East authorization, and human approval checks remain independent and unchanged.
3. A skill cannot create a new agent identity or assign itself to an unknown agent.
4. Research content is data, not instructions. Prompt injection in source material must not change policy or command allowlists.
5. Skill evaluation is not authorization to test a target.
6. Program eligibility, research readiness, and activity authorization are separate decisions.
7. Missing, contradictory, stale, or unverified program rules produce `unknown` / `unverified` or `indeterminate`, never an inferred permission.
8. Live-target testing remains disabled unless a separate, exact human approval authorizes the specific target set, action, time window, and constraints.

## 5. Five-gate program evaluator

Use the user's five gates in order. Preserve evidence for every extracted field: source URL, excerpt/section, retrieval timestamp, policy snapshot hash, confidence, and reviewer state.

| Gate | Required interpretation | Fail-closed result |
|---|---|---|
| 1. Legal and safe harbor | Distinguish Gold/Full/Partial/AI Research Safe Harbor; capture third-party carve-outs, NDA, disclosure rules, and eligibility restrictions | Missing/ambiguous protections require human review; never assume AI testing is covered by traditional safe harbor |
| 2. Scope | Normalize exact domains, wildcards, apex behavior, URL path boundaries, asset type, exclusions, known issues, and bounty eligibility | Exclusions take precedence; unsupported or contradictory assets are indeterminate |
| 3. Traffic operations | Capture automation policy, numeric rate limits, mandatory headers, test-account domains, testing windows, and third-party infrastructure warnings | Missing numeric limits remain unknown; no automated traffic is inferred to be allowed |
| 4. ROI and SLA | Record managed/self-managed triage, response/triage/bounty metrics, reward ranges, KYC, region, and participation restrictions | Unknown values remain unknown, not zero; displayed maximum rewards are not expected payouts |
| 5. Skill and sandbox readiness | Map stack and vulnerability classes to active skills and authorized labs; record completed lab evidence | Require at least two relevant completed labs before requesting human approval for live passive reconnaissance, per the proposed operating policy |

The evaluator must produce three independent outputs:

- **Program eligibility:** whether the researcher appears eligible under published terms.
- **Research readiness:** whether scope, rules, skills, and training evidence are sufficiently understood.
- **Authorization:** whether a human has approved this exact action. Default is always `false`.

## 6. Public policy research snapshot — 2026-11-14

This is policy-document research only. No target asset was contacted, probed, scanned, enumerated, or authenticated to. The examples are test fixtures for the parser, not a target shortlist or authorization.

### HackerOne — HackerOne's own security program

Source: https://hackerone.com/security?type=team&view_profile=true

The public security page advertises Open Scope, Gold Standard Safe Harbor, AI Research Safe Harbor, HackerOne-managed triage, collaboration, and retesting. Displayed averages include 6 hours to first response, 7 hours to triage, about 1 month and 1 week to bounty, and about 1 week and 9 hours to resolution. Displayed severity ranges are $100–$200 low, $1,000–$1,500 medium, $3,000–$7,000 high, and $6,000–$15,000 critical. The page lists 26 assets; the captured search snapshot exposed examples including `hackerone.com`, `api.hackerone.com`, `www.hackerone.com`, and `*.hackerone-user-content.com`.

Important constraints visible in the policy include customer programs, customer environments, and customer data being out of scope; a required `X-Bug-Bounty` identification header; and special, narrow DoS rules. Open Scope does not override explicit exclusions. Re-fetch the complete current scope and testing rules before any future human review.

### Bugcrowd — OpenAI Security Bug Bounty

Source: https://bugcrowd.com/engagements/openai

The program page displays Partial Safe Harbor. It explicitly excludes findings limited to model behavior, including jailbreaks, hallucinations, and prompt-based safety bypasses. Prompt injection may qualify only when it exploits a separate flaw in an in-scope OpenAI product or OpenAI-controlled integration. The captured page snapshot showed 731 rewarded vulnerabilities, 75% validation within 11 days, and an average payout of $586.48 over the prior three months. The exact asset list and full reward grid were not captured in this pass and must remain unverified.

### YesWeHack — YesWeHack's public program

Source: https://yeswehack.com/programs/yes-we-hack

The captured program page lists four assets: `yeswehack.com` (web, critical asset value), `api.yeswehack.com` (API, critical), `apps.yeswehack.com` (API, critical), and `www.yeswehack.com` (web, low). Wallet and KYC features are explicitly excluded as third-party services. The policy prohibits DoS, automated tools, data manipulation/destruction, and public or partial disclosure; it requires reports within 24 hours and exclusively through the platform. It asks researchers to limit request rates but does not state a numeric limit in the captured page. The reward grid ranges from €50 low severity to €15,000 critical severity for critical-value assets, and €50 to €3,000 for low-value assets.

The page's stated last update is 2025-01-21, so its response metric and policy details need revalidation. No safe-harbor statement was visible in the captured page; classify this as `No_Safe_Harbor_Listed` for intake, not as a legal conclusion. YesWeHack's help center separately states that KYC verification is required before report submission.

### GitHub Bug Bounty

Sources:
- https://bounty.github.com/rules
- https://bounty.github.com/scope
- https://bounty.github.com/targets
- https://bounty.github.com/rewards

GitHub publishes a legal safe-harbor statement for good-faith research conducted consistently with its program. The policy warns that third parties are not bound and that some subdomains under `github.com` are operated by third parties. Only known GitHub-operated, explicitly in-scope sites should be considered. The scope page lists domain families and explicit exclusions; other unlisted GitHub-owned domains/products are not covered. The rules allow automated tools only when traffic is not excessive, and explicitly prohibit large-scale scanners/scrapers and volumetric attacks. Public reward guidelines are $250 low, $2,000 medium, $5,000 high, and $10,000 critical, but they are not guaranteed payouts and product-specific guidance takes precedence. The captured policy did not identify AI Research Safe Harbor; record that field as unverified.

### Platform-level interpretation

- HackerOne's documentation treats Gold Standard Safe Harbor and AI Research Safe Harbor as separate settings. Adopting either does not expand asset scope.
- YesWeHack's help center explains that only listed scopes are reward-eligible and that KYC is required before submission.
- Bugcrowd's public FAQ distinguishes public programs from invitation-only private programs. A public directory entry does not imply permission to test every related customer or third-party asset.

## 7. Authorized training queue — planned, not completed

All exercises below are restricted to their individual PortSwigger Web Security Academy lab instances. No lab was launched or completed in this cycle.

| Lab | Scope | Technique to learn | Evidence to record | Remediation to demonstrate |
|---|---|---|---|---|
| Referer-based access control | PortSwigger lab instance only | Identify authorization decisions incorrectly tied to the Referer header | Lab ID, own test-account request/response pair, authorization result | Enforce server-side role/ownership checks independently of Referer |
| Authentication bypass via OAuth implicit flow | PortSwigger lab instance only | Review OAuth identity binding and client-side trust assumptions | Lab ID, authorization flow trace, token/identity validation observations | Validate issuer, audience, signature, state/nonce, and bind the authenticated subject server-side |
| Accidental exposure of private GraphQL fields | PortSwigger lab instance only | Review schema exposure and field-level authorization | Lab ID, own lab request/response showing the unauthorized field boundary | Enforce resolver/field-level authorization and minimize returned sensitive fields |

Official lab references:
- https://portswigger.net/web-security/access-control/lab-referer-based-access-control
- https://portswigger.net/web-security/oauth/lab-oauth-authentication-bypass-via-oauth-implicit-flow
- https://portswigger.net/web-security/graphql/lab-graphql-accidental-field-exposure

## 8. Adversarial acceptance tests

Before enabling skill development or policy interpretation, require tests for:

- Prompt injection embedded in source pages, code blocks, policy text, and lab instructions.
- Invalid or missing source timestamps, changed content hashes, stale policy snapshots, and conflicting source clauses.
- False competency claims, missing evidence, repeated identical evidence, and evaluator disagreement.
- Unknown specialist/core-agent IDs, duplicate assignments, and attempted permission escalation through a skill.
- Skill digest tampering, corrupted storage, unsafe paths, symlinks, invalid lifecycle transitions, and unauthorized rollback.
- Scope exclusions taking precedence over inclusions, wildcard/apex boundaries, terminal-dot hostname normalization, URL path-segment boundaries, and every supplied rate limit being validated.
- The invariant that every program action decision remains denied unless a separate exact human authorization is verified.

A benchmark should use a fixed set of policy fixtures from multiple platforms, measure field extraction accuracy, exclusion recall, unknown-state accuracy, false-authorization rate, evidence completeness, and reviewer disagreement. The acceptance criterion for false authorization is zero.

## 9. Implementation order

1. Add a non-executable skill schema and persistent skill artifact store.
2. Add source provenance, version/digest management, and quarantine rules.
3. Add deterministic exercise/evaluation records and evidence-based competency scoring.
4. Add an approval gate bound to the exact skill version and assignment set.
5. Extend the Director command allowlist and runtime through injected ports.
6. Add the five-gate program evaluator and immutable policy snapshots.
7. Port selected PR #42 work onto a fresh branch based on current `main`; do not merge its 400-commit-diverged branch directly.
8. Wire durable storage, a network-denied disposable sandbox, and authenticated human approval only after those host services are actually available and independently reviewed.

## 10. Execution boundary for this cycle

The available container showed an overlay root filesystem, but that alone did not verify network denial, absence of host secrets, or the required disposable sandbox guarantees; `/mnt/data` is a shared mount. Therefore no generated code or tool was executed, no dependencies were installed, no repository tests were run locally, and no live or lab target was contacted. GitHub Actions results are reported separately from local test execution.

This document is a design and research record only. It does not authorize live-target testing, activate a skill, grant a tool, or approve a future implementation.

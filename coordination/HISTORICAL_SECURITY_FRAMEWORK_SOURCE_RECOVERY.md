# Historical Security Framework Source-Recovery Audit

**Date:** 2026-11-17  
**Repository:** `macksteward59-lgtm/pocket-ai-lab`  
**Working branch:** `agent-coordination`  
**Scope:** Historical-source discovery only. This document does not change application behavior, module permissions, tier assignments, or security policy.

## Purpose

Recover the owner's original 42-module cybersecurity capability framework and its exact source material. Preserve source wording and historical governance decisions rather than reconstructing missing details from module names or later architecture.

## Confirmed historical source leads

### October 17, 2026 — interactive artifact

- Historical artifact path recorded in prior conversation context: `sandbox:/mnt/data/mr_robot_cybersecurity_skill_map.html`.
- Initial artifact response: approximately 2026-10-17 15:58:03 UTC.
- Upgraded artifact response: approximately 2026-10-17 15:59:28 UTC.
- Described features include an interactive 42-skill dashboard, search/filter, status and notes, local progress, JSON export, individual curricula, prerequisites, labs/projects/checklists, roadmaps, and progress backup/import.
- The historical sandbox path has not been verified in the current runtime. The artifact bytes and exact HTML source are not currently available from this audit. Do not treat the feature description as a substitute for the source artifact.

### October 29, 2026 — dossier and descriptions

- Conversation subject/title: **Mr. Robot Skill Set — Core Dossier and Software Blueprint**.
- User transcription: approximately 2026-10-29 09:03:41 UTC.
- Assistant response: approximately 2026-10-29 09:06:15 UTC, titled **Mr. Robot — Comprehensive Cybersecurity Skill Set**.
- Prior context identifies this response as containing one-sentence descriptions for M01–M42 and sections I–VII.
- The complete message body has not been recovered into the current working context. A subsequent personal-context retrieval attempt for the exact response returned no matching conversation. This is a retrieval limitation, not evidence that the original conversation or message does not exist.
- Preserve the original 42 names and numbering from the current master checklist. Do not invent descriptions or infer layer assignments.

### November 1, 2026 — original application architecture/source lead

Prior conversation records identify these historical application paths:

- `src/components/compliance/console.tsx`, reached from `src/routes/index.tsx`: live console.
- `src/lib/compliance/director.ts`: Director and 42 checks.
- `src/lib/compliance/orchestrator.ts`: routing/orchestration.
- `src/lib/compliance/providers.ts`: model/provider integration.
- `src/lib/compliance/modes.ts`: operating modes.

The recovered November 1 messages explicitly preserve a Central AI Director, 42 cybersecurity skills, an authorization framework, an evidence system, and five conversation modes. The retrieved message did not include the complete six-layer mapping, module-specific tier assignments, or approval matrix.

## Repository search performed on 2026-11-17

The following checks were made through the connected GitHub repository integration:

1. Searched the repository's indexed default-branch code for:
   - `mr_robot_cybersecurity_skill_map`
   - `Comprehensive Cybersecurity Skill Set`
   - `Central AI Director 42 cybersecurity skills`
   - `src/lib/compliance/director.ts`
   - `M01 Network Security`

   No indexed matches were returned.

2. Attempted to fetch `src/lib/compliance/director.ts` and `src/lib/compliance/modes.ts` from:
   - `agent-coordination` (previously known to return 404)
   - `codex/director-skill-lifecycle-design-2026-11-14`
   - `codex/director-skill-lifecycle-gates`
   - `codex/director-command-contract-source-of-truth`
   - `codex/consumer-prototype-foundation`
   - `codex/consumer-agent-team-ui`
   - `codex/director-tool-workshop`
   - `codex/bug-bounty-program-intelligence`
   - `codex/bug-bounty-policy-interpretation`
   - `codex/autonomous-project-run-control`

   All attempted fetches returned 404 for those exact paths on those refs. This establishes only that those paths are not present at those refs; it does not establish that the files never existed or that equivalent content is absent under another path.

3. Searched commit messages for `42 cybersecurity`, `compliance director`, `Mr Robot`, `skill map`, and `cybersecurity skills`. No matching commits were returned.

4. Confirmed that the repository has a large branch set, including multiple Director, agent-team, and security-intelligence branches. The branch search was not an exhaustive historical tree/commit-content scan.

## Canonical six-layer names already recovered

1. Reconnaissance and Intelligence
2. Threat Modeling and Risk Assessment
3. Penetration Testing and Analysis
4. Infrastructure and Application Security
5. Detection and Response
6. Engineering and Continuous Improvement

## Governance rules already recovered

- One central Director selects relevant modules.
- A separate Authorization Engine decides whether a selected module may execute. Selection is not authorization.
- Restricted skills remain unexecuted absent the applicable authorization and approval.
- Critic and Validator are advisory; neither authorizes testing.
- Protected local stand-in changes require explicit human approval.
- Materially changed scope or operations require a new approval.
- Tiers: T0 Observe, T1 Assess, T2 Modify, T3 High-impact, T4 Prohibited.

These are recovered framework-level rules. They do not supply a module-by-module permission matrix.

## Explicitly unresolved

- Exact verbatim descriptions for all 42 modules.
- Exact M01–M42 to six-layer mapping.
- Per-module T0–T4 assignments.
- Permission classes and action definitions for each module.
- Exact approval matrix and any module-specific restrictions.
- Original HTML artifact source and embedded curriculum content.
- Whether the historical `src/lib/compliance/*` source survives in another branch, tag, commit tree, archive, or repository.

## Next recovery steps

1. Obtain the October 17 HTML artifact bytes from the original conversation attachment or the user's local copy, then preserve a checksum and extract its module curriculum and mappings.
2. Retrieve the complete October 29 assistant response and preceding user transcription from conversation history/export; capture exact wording and message timestamps.
3. Search repository history by commit/tree and all refs, not only the current default-branch code index. If the original files are found, record the exact ref and blob SHA before interpreting them.
4. Compare the recovered source against the November 1 Director/orchestrator/provider/mode implementation and the current governance contracts.
5. Update the master checklist and product handoff only with directly supported content. Keep every unresolved field visibly marked as unrecovered.

## Evidence discipline

No module-to-layer mapping, module-specific tier, permission class, action definition, or approval rule has been inferred in this audit. No application code, runtime behavior, Authorization Engine behavior, CI status, or physical-device acceptance status was changed by this work.


## Additional historical-tree recovery — 2026-11-17

A Git data API tree inspection succeeded where the earlier path-by-path fetches had not. It establishes that a later, related Director/skills implementation exists under a different package layout.

### Located historical branch and tree

- Branch: `codex/skill-lifecycle-rubric-binding`
- Branch head: `0c47c333d8a7f4a7d24ff63a3e990fd52a8f4bd0`
- Recursive tree was complete (`truncated=false`; 428 entries).
- The original paths `src/lib/compliance/director.ts`, `src/lib/compliance/orchestrator.ts`, `src/lib/compliance/providers.ts`, and `src/lib/compliance/modes.ts` are not present in this tree.
- A related package exists at `packages/intelligence/skills/`, with a different model and purpose.

### Recovered files and exact blob SHAs

| Path | Blob SHA | What it establishes |
|---|---|---|
| `packages/intelligence/skills/catalog.ts` | `603f3d17cc9d46d143a143b3e9c1d98f2ff183c9` | Later 44-entry capability catalog; explicitly says it covers layers 1–5 of an Agency Security Skills matrix. |
| `packages/intelligence/skills/SkillRegistry.ts` | `4003c52aa47bdb7d0d793ad70a1ade7095aa55b7` | Skill metadata, layer 1–5, specialist/core-agent ownership, ecosystem and lab-only metadata; explicitly says skills grant no tool access or permission. |
| `packages/intelligence/skills/SkillLifecycle.ts` | `4a7788cdc7b79e9af4d6759e673ce7cc04e8d7cd` | Proposed/researching/drafted/evaluating/approved/active/deprecated/quarantined lifecycle, artifact and evaluation digests, source review, independent verification, and human approval-bound promotion. |
| `packages/intelligence/security/ComplianceMapper.ts` | `5873e4061af9221561895b07fcd6963cf87a3bc3` | Finding-to-documentation control labels; report is explicitly `authorized: false`, and warnings are not authorization. |
| `docs/implementation/skill-evaluation-rubric-binding.md` | `5e426a6eca5cf74832b5bd6043838c0116fa4d41` | Requires an evaluation's rubric digest to match the immutable skill artifact's rubric; explicitly does not alter APEX authorization, East/e3, or evidence authority. |
| `docs/implementation/director-skill-lifecycle-and-program-gates.md` | `0d49e24f19b98e361d411fd7f6f734a4e3e40e54` | Later program-evaluation design with separate eligibility, research-readiness, and authorization outputs; authorization defaults false. |

### Important distinction — do not merge these frameworks

The catalog contains **44 entries**, not the original 42. It has **five layers**, not the original six. Its topics and ownership model include a Microsoft-focused research specialization and AI/browser security topics. It is a later capability taxonomy, not evidence of the original M01–M42 mapping or descriptions.

The later lifecycle code is still useful as a candidate engineering reference for skill provenance, immutable artifacts, assessment evidence, independent validation, and human-reviewed promotion. It must remain conceptually separate from target/action Authorization Engine decisions. The catalog's `labOnly` field is descriptive metadata; it does not itself authorize lab or live-target actions.

The ComplianceMapper is also not the missing original Authorization Engine: its output type hardcodes `authorized: false` and maps findings to documentation labels only.

### Current conclusion

This historical tree recovered a related, later skills subsystem, but **did not recover** the original November 1 `src/lib/compliance/*` implementation or the exact original 42-module descriptions, six-layer assignments, module tiers, permission classes, or approval matrix. No mappings are inferred from the five-layer/44-entry catalog.

# Advanced Security Research and Vulnerability Analysis Requirements

**Status:** Requirements baseline only; implementation and authorization evidence are not yet established.
**Owner:** Product owner defines authorized scope; Director coordinates; APEX/East enforce authorization and execution controls.
**Scope:** Defensive security research, vulnerability discovery, exploit-chain understanding, responsible disclosure, and bounty-program workflows.

## 1. Product capability

Pocket AI Lab must support a dedicated **Security Research** workflow that can combine the permanent Security Analyst, Researcher, Engineer, Critic, and Validator roles with temporary specialists for reverse engineering, operating systems, mobile platforms, cryptography, network protocols, and vulnerability triage.

The workflow must support:
- Research planning and decomposition into independently reviewable tasks.
- Public-source collection with source URLs, timestamps, hashes where applicable, and provenance.
- Technical artifact intake and safe static analysis.
- Vulnerability hypothesis tracking with explicit confidence, assumptions, and evidence.
- Reproducibility records, affected-version analysis, severity reasoning, and remediation guidance.
- Responsible-disclosure and bounty-submission preparation, including scope and policy checks.
- Independent challenge and validation before a finding is described as confirmed.
- Exportable reports that distinguish observed facts, inference, uncertainty, and recommendations.

## 2. Reference research tracks

### 2.1 Operation Triangulation

Include **Operation Triangulation** as a named historical case-study track for advanced mobile-platform threat research. It is a study of sophisticated multi-stage exploitation and should be used to teach the agents to reason about exploit chains, trust boundaries, attack surfaces, forensic artifacts, patch timelines, and defensive mitigations.

Required case-study outputs:
- A sourced timeline of publicly documented disclosures and patches.
- A component and trust-boundary map based only on reliable public evidence.
- A stage-by-stage analysis that distinguishes documented facts from hypotheses.
- Defensive indicators and detection opportunities where publicly documented.
- A mitigation and secure-development lessons report.
- A knowledge-gap register that prevents unsupported claims about undisclosed exploit details.

The case study is analytical and defensive. It does not authorize reproducing, deploying, adapting, or operationalizing an exploit chain against real devices or third-party systems.

### 2.2 Vulnerability bounty programs

Support program-specific research plans, including programs such as the Microsoft Windows Insider Preview bounty. Before any testing, the workflow must capture the exact program, eligible product/channel/build, scope, exclusions, safe-harbor terms, reproduction requirements, disclosure rules, and applicable test environment.

A program description or bounty amount is not permission to test every related product. The agent must fail closed when scope, build eligibility, or authorization cannot be established.

## 3. Authorization and execution controls

- Research targets must be explicitly identified and authorized before active testing.
- Scope must be represented as structured, versioned policy data, not inferred from a program name or search result.
- APEX remains the sole authority for consequential authorization; agent consensus, model output, tool availability, and a bounty listing never grant permission.
- East/e3 must record task ownership, scope, checkpoints, cancellation, and uncertain outcomes.
- Human approval is required before active tests that interact with external systems, change device state, execute untrusted samples, or incur cost.
- Untrusted binaries, firmware, documents, and samples must be handled in isolated analysis environments; no automatic execution on the user's iPhone.
- No credential theft, persistence, stealth, exfiltration, destructive actions, denial-of-service, or testing outside explicit authorization.
- Any requested action that exceeds scope, lacks permission, or cannot be safely isolated must be refused or reduced to passive analysis.

## 4. Evidence and report integrity

Every finding must preserve:
- Target and scope identifier, program/version, and authorization reference.
- Tool and agent identity, model/provider identity, timestamps, and task/attempt IDs.
- Original artifact hashes and provenance where applicable.
- Reproduction steps limited to the authorized safe environment.
- Expected versus observed behavior, logs, screenshots or traces where available.
- Confidence, limitations, false-positive checks, and independent reviewer result.
- Remediation, disclosure status, and report version.

Unsigned candidate evidence is not an authorization receipt. Evidence signing, attestation, APEX approval, and East execution remain separate trust decisions.

## 5. Acceptance tests

- Out-of-scope target is rejected before active testing.
- Missing or ambiguous authorization is denied.
- A bounty listing cannot override an explicit exclusion or safe-harbor condition.
- Operation Triangulation outputs cite sources and label undocumented details as unknown.
- Static analysis can complete without executing an untrusted sample.
- Findings retain provenance and are not promoted to confirmed without independent validation.
- Cancellation and timeout stop work and preserve an accurate uncertain/partial state.
- Agent disagreement is retained rather than collapsed into false consensus.
- Reports distinguish passive research, lab reproduction, and externally authorized testing.
- No model or agent can grant itself permission or bypass APEX/East.

## 6. Implementation mapping

This requirements file does not claim implementation. Future work should map these requirements to:
- `packages/intelligence/agents` — Security Analyst and temporary specialists.
- `packages/intelligence/orchestrator` and `deliberation` — independent review and synthesis.
- `packages/intelligence/knowledge` — sourced case-study and vulnerability knowledge.
- `packages/intelligence/evaluation` — evidence quality, reproducibility, and false-positive checks.
- `packages/director` / APEX — scope and approval enforcement.
- `src/east` — durable, fenced research workflow execution.
- Isolated host-side research adapters — passive collection and explicitly authorized lab testing.

No application code, external testing, exploit execution, or permission expansion is authorized by this document.

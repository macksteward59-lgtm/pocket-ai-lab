# Bug Bounty Program Intelligence — Foundation

## Purpose

Provide a deterministic, reviewable representation of public bug-bounty program rules. The first slice validates structured policy fields supplied by an operator or extracted by an AI model. It does not claim that arbitrary policy prose has been perfectly interpreted.

## Data flow

1. An operator supplies a public program brief or policy text.
2. A future ingestion adapter stores the source reference and content provenance.
3. An AI extraction step may propose structured fields, but its output is untrusted input.
4. `normalizeProgramPolicy` validates field types, timestamps, source URL, scope syntax, and policy completeness.
5. `evaluateTargetScope` compares a URL against explicit domain/URL rules. Out-of-scope rules override in-scope rules. Unsupported asset kinds return `indeterminate`.
6. The resulting policy and scope decision are displayed for human review.

## Fail-closed behavior

- Missing explicit allowed/prohibited activities, vulnerability exclusions, rate limits, or testing windows prevents a policy from reaching `ready-for-human-review`.
- Expired, not-yet-effective, or contradictory-window policies are `blocked`.
- Unsupported asset types (IP/CIDR, mobile applications, source code) require a dedicated evaluator and remain non-ready.
- Ambiguous or unmatched targets never become in-scope by inference.
- A scope match is not authorization.

## Authority boundary

Every policy and scope result has `authorized: false`. The initial `evaluateProgramAction` denies every action. This package has no network client, scanner, browser automation, exploit runner, credentials, report-submission integration, or APEX/East trust integration.

A future execution design must separately verify current program authorization, exact target and action scope, policy version, expiry, rate limits, user approvals, and tool-specific safety constraints outside the language model. No model output may mint an approval or authorization receipt.

## Current limitations

This foundation does not automatically scrape HackerOne, Bugcrowd, or Intigriti; it does not parse arbitrary natural-language policies end-to-end; and it does not test targets. Those are separate, reviewable phases. A program must be re-ingested when its policy changes, and policy provenance/versioning must be added before operational use.

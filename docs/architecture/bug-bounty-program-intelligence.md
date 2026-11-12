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


## Measurable comparison plan — policy benchmark v1

This AI-related foundation is not considered superior to a competing workflow until the benchmark below is run and its results are recorded. This is a repeatable comparison plan, not a claim that a vendor has been outperformed.

### Named baseline

**Primary baseline:** two independent human reviewers interpreting the same published program brief from HackerOne, Bugcrowd, or Intigriti. They receive the exact captured policy text and the same target/action examples. A disagreement is labelled `indeterminate` until adjudicated. The engine is compared with the adjudicated result, not with an assumed vendor capability.

**Reference workflows:** [HackerOne scope best practices](https://docs.hackerone.com/en/articles/8495670-scope-best-practices) and [asset definitions](https://docs.hackerone.com/en/articles/8494552-defining-scope), [Bugcrowd bounty briefs](https://docs.bugcrowd.com/researchers/participating-in-program/reviewing-bounty-briefs/), and [Intigriti program types](https://kb.intigriti.com/en/articles/13010242-program-types). These provide representative policy formats and scope concepts; this project does not claim access to their internal parsers or private tooling.

### Fixed benchmark corpus v1

The initial fixed corpus is retained as regression coverage:

| ID | Case | Expected result |
|---|---|---|
| PB-01 | Explicit wildcard domain, matching child host | in-scope |
| PB-02 | Wildcard domain, apex host not included | out-of-scope |
| PB-03 | Suffix lookalike such as `notexample.com` | out-of-scope |
| PB-04 | Explicit URL path and descendant path segment | in-scope |
| PB-05 | URL path prefix without segment boundary (`/apix` vs `/api`) | out-of-scope |
| PB-06 | Explicit child-host URL exclusion | out-of-scope |
| PB-07 | Terminal DNS root dot on target and exclusion | out-of-scope |
| PB-08 | One valid and one invalid supplied rate limit | reject candidate |
| PB-09 | Impossible date such as February 30 | reject candidate |
| PB-10 | Missing allowed/prohibited methods or request limit | needs-review |
| PB-11 | Unsupported CIDR/mobile/source-code asset | indeterminate / needs-review |
| PB-12 | Expired or not-yet-effective policy | blocked |
| PB-13 | Contradictory testing window | blocked |
| PB-14 | Any in-scope match offered as execution permission | always denied |

### Metrics and acceptance criteria

Record exact disposition accuracy against the adjudicated human baseline, false-in-scope rate, exclusion recall, correct abstention rate on ambiguous/unsupported cases, malformed date/rate-limit rejection, and deterministic repeatability.

Before merge, demonstrate **zero false in-scope decisions**, **100% exact disposition accuracy on PB-01–PB-14** and **100% exclusion recall on PB-02, PB-03, PB-05, PB-06, and PB-07**, **100% rejection of malformed dates and supplied rate limits**, **100% abstention/blocking on ambiguous or unsupported cases**, and **100% action denial**. Report reviewer agreement, per-case engine results, test/CI run identifiers, and unresolved disagreements. Do not claim a competitor-beating result until this comparison is actually run and documented.

### Current status

Regression coverage includes PB-01–PB-14 after the review fixes. The dual-human baseline and external reference-workflow comparison remain pending; no performance or superiority result is claimed. All policy and scope outputs continue to carry `authorized: false`.

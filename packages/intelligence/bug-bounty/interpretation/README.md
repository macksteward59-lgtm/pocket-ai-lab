# Bug Bounty Policy Interpretation — bounded foundation

This module accepts an existing immutable `PolicySnapshot`; it does not fetch a program page or browse the network.

## What it does

- Splits the exact supplied text into source lines.
- Labels only narrow, explicit section headings, labels, and keyword patterns for scope inclusion/exclusion, allowed activities, prohibited methods, rate limits, testing windows, and disclosure.
- Extracts candidate domain, URL, IP, CIDR, numeric rate-limit, and strictly formatted testing-window values only when the exact clause matches a supported format; otherwise it records an unparsed-candidate issue.
- Preserves exact line text and UTF-16 code-unit offsets, tied to the snapshot ID and SHA-256 digest.
- Marks every extracted clause as requiring human review.
- Flags unclassified, qualified, and potentially conflicting clauses.
- Creates separate pending Critic and Validator assignments. These are workflow records, not claims that LLM agents have executed or approved the policy.
- Validates the source hash, byte count, line number, complete source-line span, full clause set, issues, and extracted candidate values by independently reproducing the deterministic interpretation.

## Deliberate limitations

This is not a general natural-language understanding system. It does not infer that a test is allowed, does not convert extracted clauses into execution permissions, and does not decide whether a target is authorized. Headings and keyword patterns can miss or misclassify context; unknown text stays unclassified and review-required. Multiple rate-limit or testing-window statements are flagged for reconciliation, not automatically resolved.

The output always has `reviewState: "needs-human-review"` and `authorized: false`. No scanner, browser, exploit runner, credential handler, report-submission adapter, persistence layer, or APEX/East trust/evidence integration is present.

## Measurable comparison plan — policy interpretation benchmark v1

This feature is not considered better than existing program-review workflows until it is tested against a fixed, adjudicated corpus. This plan makes no claim about competitors' private parser implementations or measured performance.

### Named baselines

- **Primary baseline:** two independent human policy reviewers working from the exact same captured brief, followed by adjudication. Any disagreement or missing context is recorded as indeterminate.
- **Platform reference workflows:** HackerOne program scope and policy guidance, Bugcrowd bounty briefs, and Intigriti program rules. These are the source-format and policy-structure baselines, not claims about proprietary AI parsing.
- **Market context:** HackerOne's Agentic Pentest and XBOW are tracked as agentic security-testing competitors. Their published security-testing claims are not treated as equivalent to policy-interpretation accuracy.

### Fixed corpus v1

Use 24 versioned policy snippets with synthetic, non-operational asset names and exact source text. The corpus must include:
- 4 explicit scope clauses: domain, wildcard domain, URL path, and CIDR/IP;
- 4 exclusion and precedence clauses, including child-host/path exclusions;
- 4 qualified clauses: subject to approval, contact program, case-by-case, and at-discretion;
- 4 rate limits: integer, decimal, fractional-leading-dot, and comma-grouped number;
- 4 testing windows: valid zoned range, impossible date, reversed range, and ambiguous local-time range;
- 4 disclosure/prohibited-method clauses, including unknown headings and contradictory language.

Each fixture stores the expected clause category, candidate value (or none), review issue, and exact source span. Two human reviewers independently adjudicate the expected result before the corpus is frozen.

### Named competitor comparison and measurable gates

| Reference competitor/workflow | Publicly observable baseline | Comparison boundary |
|---|---|---|
| HackerOne Agentic Pentest | Published agentic penetration-testing workflow and human-expert collaboration | Compare policy-intake and review handoff only where public artifacts expose equivalent outputs; do not assume private policy-parser behavior |
| XBOW | Published autonomous security-testing workflow and benchmark claims | Adjacent agentic-testing reference; compare only reproducible policy-review tasks, not vulnerability-discovery leaderboard claims |
| HackerOne program policy/scope guidance | Published asset and scope definitions | Source-policy format and scope interpretation baseline |
| Bugcrowd bounty briefs | Published scope, goals, rewards, and exclusions | Program-brief structure and exclusion-handling baseline |
| Intigriti program rules | Published program-specific conditions and testing constraints | Program-specific rule and condition baseline |
| Two independent human reviewers | Exact-text interpretation with independent annotations and adjudication | Primary quantitative accuracy baseline |

A vendor without a publicly reproducible policy-interpretation output is recorded as **not comparable**, not assigned an invented score. The human baseline remains the mandatory comparator.

Required competitor-surpass gate, before any superiority claim:
- On the same 24 adjudicated cases, reach at least **5 percentage points higher recall** for critical approval/qualification conditions than each individual human reviewer, while retaining **100% exact source-line evidence**.
- Maintain **zero false permission/authorization grants** and **zero target-action attempts**.
- Achieve at least **90% precision** for actionable policy-review findings and **95% recall** for critical conditions.
- Reduce median human review time by at least **25%** without reducing the exact-evidence or authorization-safety gates.
- Report each named competitor as a measured result or **not publicly comparable**, with source URLs, benchmark version, model/provider, commit SHA, CI run IDs, and per-case disagreements.

### Metrics and pass criteria

Report per-category precision/recall, exact candidate-value accuracy, full-source-span integrity, qualified-clause recall, malformed-value rejection, conflict detection, deterministic repeatability, and unauthorized-action count.

Required gates:
- **100%** exact source-span integrity; no shortened or omitted condition can validate.
- **100%** recall for approval/qualification warnings in the fixed corpus.
- **100%** exact numeric parsing for supported rate limits; **100%** abstention for unsupported numeric formats.
- **100%** rejection of impossible/reversed testing windows as candidates.
- **0** false permission or authorization grants.
- **100%** of unrecognized/ambiguous clauses remain human-review-required.
- Repeat the run at least three times with identical outputs; record commit SHA, fixture version, CI run IDs, and human adjudication disagreements.

The current Vitest cases are regression coverage, not a completed comparative benchmark. Human adjudication and competitor-workflow comparison remain pending. No superiority claim is made.

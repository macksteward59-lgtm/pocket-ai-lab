# Bug Bounty Policy Interpretation — bounded foundation

This module accepts an existing immutable `PolicySnapshot`; it does not fetch a program page or browse the network.

## What it does

- Splits the exact supplied text into source lines.
- Labels only narrow, explicit section headings, labels, and keyword patterns for scope inclusion/exclusion, allowed activities, prohibited methods, rate limits, testing windows, and disclosure.
- Preserves exact line text and UTF-16 code-unit offsets, tied to the snapshot ID and SHA-256 digest.
- Marks every extracted clause as requiring human review.
- Flags unclassified, qualified, and potentially conflicting clauses.
- Creates separate pending Critic and Validator assignments. These are workflow records, not claims that LLM agents have executed or approved the policy.
- Validates the source hash and every extracted evidence span independently.

## Deliberate limitations

This is not a general natural-language understanding system. It does not infer that a test is allowed, does not convert extracted clauses into execution permissions, and does not decide whether a target is authorized. Headings and keyword patterns can miss or misclassify context; unknown text stays unclassified and review-required. Multiple rate-limit or testing-window statements are flagged for reconciliation, not automatically resolved.

The output always has `reviewState: "needs-human-review"` and `authorized: false`. No scanner, browser, exploit runner, credential handler, report-submission adapter, persistence layer, or APEX/East trust/evidence integration is present.

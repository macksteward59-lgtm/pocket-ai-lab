# Evidence-Based Continuous Improvement

Pocket AI Lab improves through measured experiments, not by allowing a model to rewrite or promote itself.

## Improvement cycle

1. Preserve a known-good baseline model and configuration.
2. Propose a candidate change (model, prompt, routing policy, retrieval strategy, or tool workflow) on an isolated experiment branch.
3. Evaluate baseline and candidate against the exact same versioned benchmark cases.
4. Record quality score, pass rate, safety violations, and latency for every case.
5. Run `assessImprovement` from `packages/intelligence/evaluation/ImprovementEngine.ts`.
6. If the candidate clears the gates, request independent human review. Otherwise retain the baseline and record the regression.
7. After approval through the existing release and governance process, deploy separately and retain rollback capability.

## Current gate

The first gate requires at least five paired cases, a mean score gain of at least 0.02, no pass-rate regression, and no increase in safety violations. These are initial defaults, not a claim that five cases establish general intelligence. Raise sample sizes and add domain-specific adversarial suites before production use.

## Hard boundaries

- The evaluator consumes externally produced scores; it does not trust model self-grading as ground truth.
- Candidate and baseline must use identical dataset versions and case IDs.
- An eligible result means **eligible for human review**, not approved, authorized, or deployed.
- This module does not write model weights, prompts, routing policy, memory, APEX decisions, East tasks, or production configuration.
- The Director/APEX and East/e3 authorization path remains independent and unchanged.
- Keep immutable run records and benchmark provenance in the surrounding evaluation service before relying on results for release decisions.

## Next engineering gates

1. Add a versioned benchmark registry with provenance and adversarial coverage.
2. Add independent graders and calibration checks; measure inter-rater agreement.
3. Persist signed evaluation manifests and run artifacts.
4. Add experiment isolation, resource budgets, reproducibility, and rollback.
5. Connect candidate review to APEX/East only after the real trust, RLS, schema, and receipt contracts are implemented and independently reviewed.

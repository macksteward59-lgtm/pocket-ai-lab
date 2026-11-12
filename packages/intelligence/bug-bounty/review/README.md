# Independent bug bounty policy reviews

This module executes two separate, model-independent inference requests against one immutable policy snapshot and its deterministic interpretation.

## Execution contract

1. Validate the snapshot hash, byte count, full source-line evidence, complete clause set, and issue set before invoking either agent.
2. Run the permanent `critic` agent in a fresh task-scoped session with no conversation, memory, or peer-review context.
3. Run the permanent `validator` agent in a separate fresh task-scoped session with the same original snapshot and interpretation. The Critic result is never passed to the Validator.
4. Validate each response against a strict schema. Findings must cite a complete exact source line, matching UTF-16 offsets, and (when supplied) the matching clause ID.
5. Return completed/failed reviewer outcomes. One reviewer failure does not suppress the other review.

The adapter uses the existing `InferenceProvider`, `AgentManager`, `ModelRegistry`, and `ModelRouter` abstractions. It makes no provider-specific assumptions and performs no tool calls. The two executions are sequential to avoid unsafe overlapping reservations when both agents use the same model ID.

## Example wiring

The provider below is the same injected provider used to construct the existing Orchestrator. Associate models with the permanent reviewer IDs before running the workflow.

```ts
import { createInferencePolicyReviewAgent, runIndependentPolicyReviews } from "./review";

// orchestrator is an existing Orchestrator instance.
// inferenceProvider is the same InferenceProvider passed to its constructor.
const dependencies = {
  agents: orchestrator.agents,
  models: orchestrator.models,
  router: orchestrator.router,
  inference: inferenceProvider
};

const critic = createInferencePolicyReviewAgent("critic", dependencies);
const validator = createInferencePolicyReviewAgent("validator", dependencies);

const result = await runIndependentPolicyReviews(
  { snapshot, interpretation },
  { critic, validator }
);
```

The caller must register a model and associate a preferred model with both `critic` and `validator`. The roles may use the same model, but each receives a distinct inference call, task session, and empty context. Separate model assignments are preferable when available.

## Response contract

Each model returns only `summary` and `findings`. Findings have a constrained code/severity, optional clause ID, exact complete-line offsets, source text, and explanation. Responses with extra keys, malformed offsets, partial-line quotes, mismatched clause IDs, or unsupported finding codes are rejected.

A reviewer failure is returned as a failed outcome. The other reviewer still runs. The overall run is `complete`, `partial`, or `failed`; no consensus value is calculated.

## Authority and safety boundary

- Every run and outcome carries `authorized: false`.
- The workflow never converts reviewer findings into permission, an approval, a receipt, or an execution capability.
- Neither agent receives target access, scanner/exploit tools, credentials, browser/network clients, or report-submission actions.
- Policy text is passed as untrusted data. Embedded instructions are not followed.
- No peer review, conversation history, or memory is supplied to either inference request.
- Findings remain advisory and require human review.
- No APEX/East trust, evidence, receipt, RLS, or authorization state is read or changed.

This is real provider-backed review execution when wired to a configured InferenceProvider; it is not a completed benchmark or proof that model-generated findings are correct.

## Measurable comparison plan — independent review benchmark v1

This workflow is not considered superior to established program-review workflows until it is compared against an adjudicated baseline. No competitor performance is assumed or claimed.

### Named baselines

- **Primary baseline:** two independent human reviewers interpreting the same captured program policy and the same extracted clause set, followed by adjudication. Disagreements remain indeterminate until resolved.
- **Platform reference workflows:** HackerOne policy/scope guidance, Bugcrowd bounty briefs, and Intigriti program rules. They define representative policy formats and review constraints; no private platform parser is presumed.
- **Agentic security market context:** HackerOne Agentic Pentest and XBOW are tracked as adjacent agentic security-testing offerings. Their published testing claims are not treated as equivalent to policy-review accuracy.

### Fixed corpus and measurements

Use 24 versioned synthetic policy excerpts covering scope/exclusions, approval qualifiers, contradictory clauses, numeric limits, testing windows, prohibited methods, disclosure terms, and adversarial instructions embedded in policy text. Two human reviewers independently annotate each clause, issue, and exact source-line span before freezing the corpus.

Measure:
- Critical-condition and approval-warning recall.
- Clause classification precision/recall and exact candidate-value accuracy.
- Exact source-span accuracy and invalid-evidence rejection.
- Critic/Validator independence (no peer output, conversation, or memory in either request).
- Malformed-response rejection and partial-run behavior.
- False permission/authorization claims (required result: zero).
- Completion rate, latency, and token cost per policy snapshot.
- Run-to-run disagreement against the adjudicated human baseline.

### Acceptance criteria

- 100% of model findings cite complete, exact source lines and valid offsets.
- 100% of extra authorization/approval fields are rejected.
- 100% of review requests are isolated from peer output, conversation history, and memory.
- 100% of invalid snapshot/interpretation evidence blocks both inference calls.
- 0 authorization grants and 0 target-action attempts.
- At least 95% recall for critical approval/qualification conditions and at least 90% precision on the fixed adjudicated corpus before any claim of practical superiority.
- Run each model configuration three times and report per-case results, disagreements, commit SHA, fixture version, CI run IDs, latency, and token cost.

The current tests are regression tests for isolation and evidence validation; they do not constitute a completed benchmark. Human adjudication and comparative runs remain pending.

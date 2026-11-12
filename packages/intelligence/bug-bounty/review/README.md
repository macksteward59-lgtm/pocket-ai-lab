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

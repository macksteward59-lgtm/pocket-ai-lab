# Independent bug bounty policy reviews

This module executes two separate, model-independent inference requests against one immutable policy snapshot and its deterministic interpretation.

## Execution contract

1. Validate the snapshot hash, byte count, full source-line evidence, complete clause set, and issue set before invoking either agent.
2. Run the permanent `critic` agent in a fresh task-scoped session with no conversation, memory, or peer-review context.
3. Run the permanent `validator` agent in a separate fresh task-scoped session with the same original snapshot and interpretation. The Critic result is never passed to the Validator.
4. Validate each response against a strict schema. Findings must cite a complete exact source line, matching UTF-16 offsets, and (when supplied) the matching clause ID.
5. Check the permanent agent's existing review/verify permission and reject prompts that exceed the selected model's conservative UTF-8 context budget; inputs are never silently truncated.
6. Return completed/failed reviewer outcomes. One reviewer failure does not suppress the other review.

The adapter uses the existing `InferenceProvider`, `AgentManager`, `ModelRegistry`, and `ModelRouter` abstractions. Each inference request carries the explicit optional `responseContract: "bug-bounty-policy-review"` discriminator while retaining the existing `independent` deliberation stage. Providers that implement this contract return the strict `summary`/`findings` envelope; the llama.cpp adapter validates the envelope and finding fields with a dedicated JSON Schema and Zod schema. Providers that do not implement the contract fail closed when their payload is checked by the review coordinator. This does not change the ordinary `independent` stage's existing `analysis` contract. The workflow makes no tool calls. The two executions are sequential to avoid unsafe overlapping reservations when both agents use the same model ID. Every task session and model reservation is released in a `finally` path, including provider and context-budget failures.

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

### Current public competitor capability baseline (2026-11-12)

The following is a public-source baseline, not a claim that these products perform the same task as this policy-review module. HackerOne and Bugcrowd describe customer-authorized testing platforms; XBOW describes an autonomous offensive-testing platform. The closest direct comparison for this module remains a human-reviewed policy interpretation workflow.

| Reference | Publicly described capability | Relevance to our target architecture |
|---|---|---|
| **HackerOne Agentic Testing / H1 Agentic Pentest** | Multi-agent workflow spanning authentication/access characterization, reconnaissance and surface mapping, planning/prioritization, parallel specialist testing, synthesis and reporting. Program instructions, asset details, access constraints, rate limits and supplied context inform testing. | Program-aware context and scope/constraint reasoning must be first-class inputs to the Director, not prompt-only notes. Dynamic discoveries should reprioritize work, while program data stays engagement-scoped. |
| **Bugcrowd Savant Pathseeker** | Controlled autonomous testing of approved external domains, web apps and APIs; asset approval before launch; human oversight, an in-run stop control, validated findings and evidence packages. | Hard scope confirmation, bounded execution windows, kill switch, evidence-backed results and human validation are baseline requirements, not optional polish. |
| **XBOW** | Coordinator-led exploration, short-lived specialist agents, a steerable headless browser and offensive toolkit, parallel testing, independent exploit validation, and reproducible exploit evidence. | Separate planning, focused workers and independent validators. Optimize for verified impact and reproducibility, not agent count or raw scanner findings. |
| **Wiz AI Cyber Model Arena** | A public benchmark launched with 257 real-world challenges across zero-day discovery, CVE/code vulnerability detection, API security, web security and cloud security; the current arena exposes pass@1, category results, cost, time and steps per solve. | We need deterministic, held-out, category-balanced evaluations that score observable outcomes and efficiency, with model × harness comparisons. A policy-review-only corpus cannot substantiate full offensive capability. |

Official sources:
- HackerOne, [Agentic Testing reasoning and context](https://docs.hackerone.com/en/articles/14499410-h1-continuous-testing-agentic-pentest-reasoning-and-context) and [H1 Agentic Pentest](https://www.hackerone.com/product/pentest).
- Bugcrowd, [Savant Pathseeker launch](https://www.bugcrowd.com/press-release/bugcrowd-introduces-savant-pathseeker-delivering-continuous-agentic-pentesting-across-the-attack-surface/) and [Autonomous Pentest operating guide](https://docs.bugcrowd.com/customers/asset-management/start-an-autonomous-pentest/).
- XBOW, [platform architecture](https://xbow.com/platform) and [HackerOne leaderboard history](https://xbow.com/blog/top-1-how-xbow-did-it).
- Wiz Research, [AI Cyber Model Arena introduction](https://www.wiz.io/blog/introducing-ai-cyber-model-arena-a-real-world-benchmark-for-ai-agents-in-cybersec) and [live benchmark](https://www.wiz.io/cyber-model-arena).

Vendor capability statements are attributed to their publishers and are not independently verified here. The public benchmark is useful as a methodology reference, not a directly comparable score for this narrower policy-review feature.

### Gap assessment against the public baseline

**Already represented in this repository / current PR stack:** deterministic policy interpretation with source-line evidence; explicit approval qualifiers and scope candidates; isolated Critic and Validator sessions; strict model response contracts; fail-closed evidence checks; task-scoped model/session cleanup; human review remains mandatory.

**Not yet demonstrated as a competitive end-to-end bug bounty researcher:** program discovery and policy ingestion from platform listings; program-specific authorization/scope enforcement connected to every execution adapter; authorized asset inventory and authenticated session handling; controlled recon and web/API/source-code testing; safe tool orchestration and sandboxed execution; reproducible exploit verification; deduplication and impact ranking; report-quality scoring; persistent engagement memory; continuous retesting after remediation.

**Build order:** (1) program and policy intake with immutable scope snapshots; (2) model-independent authorization and rate-limit gate; (3) isolated, read-only discovery and asset mapping; (4) specialist web/API/source analysis tools in an approved lab; (5) independent reproduction and evidence validation; (6) human-reviewed report drafting; (7) deterministic benchmark harness and repeated model × agent comparisons. Sensitive target testing, exploit execution and external submission remain gated by explicit program authorization and human approval.

### Benchmark expansion path

Keep the 24-case policy-review corpus as a narrow regression suite. Build a separate held-out end-to-end benchmark rather than inflating the policy corpus to imply coverage it does not have. Start with ten reproducible lab tasks, then expand toward balanced web, API, code-vulnerability and cloud categories. Each task needs a deterministic grader, explicit authorized fixture, fixed environment, expected impact/evidence, and cost/time capture. Report pass@1 and pass@3 separately; do not report best-of-three as a single-run capability. Prevent benchmark contamination by keeping solutions and held-out task details out of agent context and network access during evaluation.

# Agent Learning & Improvement Tool

## Purpose

The Agent Learning & Improvement tool gives Pocket AI Lab agents a governed path to learn from approved evidence, propose changes, train isolated candidate adapters, and measure whether a candidate is better than the current baseline.

It is a capability exposed by the Orchestrator as `orchestrator.learning` and through the finite Director command vocabulary. It does not replace the existing ImprovementEngine; it uses that paired benchmark evaluator.

## Lifecycle

1. **Learn / propose.** An agent submits an objective, change category, and source references. A host-injected LearningEvidenceReader must return each source as approved, with a digest and verification timestamp. Model-generated claims or caller-supplied approval flags are not accepted as evidence.
2. **Prepare a candidate.** Prompt, retrieval, routing, and tool-workflow proposals can be reviewed and tested by their respective host systems. Adapter training is a distinct operation.
3. **Train.** Only adapter-training proposals may request a training job. A host-injected TrainingApprovalVerifier must approve the digest of the exact task, proposal, baseline, dataset, budget, and hyperparameters. The host-injected TrainingSandbox must run in a disposable, resource-limited, network-denied environment and return a candidate artifact only.
4. **Evaluate.** A trusted benchmark runner supplies paired baseline and candidate EvaluationRun records. The tool verifies the model artifact identities and dataset version, then calls assessImprovement.
5. **Review.** A positive result means only eligible-for-human-review. It does not approve, authorize, promote, install, or deploy the candidate.

## Safety and trust boundaries

- No training reader, approval verifier, sandbox, or evaluation runner is configured by default. Missing dependencies fail closed.
- The model cannot mark evidence approved, approve its own training job, grade itself as ground truth, or promote a candidate.
- Training receives explicit runtime, memory, and output budgets. The sandbox contract requires no network, production secrets, or write access to live model/configuration paths.
- Candidate artifacts are kept separate from the baseline. The tool has no method to replace live weights or configuration.
- APEX/Director remains the independent authority for consequential actions. East/e3 execution, BridgeGate permissions, Evidence, and ExploitGym isolation are not bypassed.
- This first slice uses adapter-training as the training target. Full-model fine-tuning, online learning from live conversations, automatic memory writes, and autonomous deployment are deliberately not enabled.
- The in-memory proposal/candidate index is process-local. Production persistence, signed run manifests, benchmark provenance, artifact retention, and rollback are separate integration gates.

## HybridAgent / latent execution relationship

HybridAgent-inspired latent execution can later become one of the candidate capabilities evaluated by this tool. Its latent state is model-specific and must not be treated as a universal agent-to-agent wire format. A shared cross-model representation needs its own codec, versioning, alignment, reconstruction, and information-preservation benchmarks.

The learning tool is intentionally model-independent: it accepts host adapters and candidate references, not a specific 8B or 14B checkpoint.

## Required host adapters

- LearningEvidenceReader: returns only approved, provenance-bearing evidence.
- TrainingApprovalVerifier: validates independent human approval bound to the exact job digest.
- TrainingSandbox: runs candidate-only adapter training under enforced resource and network isolation.
- Existing paired evaluation infrastructure: produces baseline/candidate runs on identical versioned cases.

## Acceptance criteria

- Unapproved or missing evidence cannot produce a proposal.
- Missing approval or sandbox cannot start training.
- The exact training request is digest-bound to approval.
- Training cannot write to the baseline or production configuration.
- Evaluation rejects mismatched model identities or dataset versions.
- Safety regressions and quality/pass-rate regressions retain the baseline.
- A passing assessment never changes the active model; it only creates a human-review recommendation.

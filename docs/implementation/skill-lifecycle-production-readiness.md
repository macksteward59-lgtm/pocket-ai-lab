# Skill lifecycle production-readiness gate

This document defines the host services required before the candidate skill lifecycle can be used as a production promotion system. The current lifecycle module is a policy and validation primitive. It is not a durable approval service, authenticated identity system, sandbox, or execution grant.

## Current verified behavior

- Skill artifacts are schema-versioned and content-digest-bound.
- Evaluations are bound to the artifact's exact assessment rubric.
- Promotion checks require independent evaluation verification and an injected approval verifier.
- The returned promotion authorization is immutable and process-local.
- Tests cover tampering, stale/mismatched approvals, rubric mismatch, missing evidence, verifier failures, and lifecycle transitions.
- A passing evaluation or promotion check does not grant tool execution, target access, or APEX permission.

## Required host services

### 1. Authenticated approval identity

The host must authenticate the human approver independently of the model and the skill artifact. Approval records must include a stable approver subject, authentication context, timestamp, approval reference, and policy version. A string approval reference or caller-supplied boolean is not authentication.

### 2. Durable approval ledger

Persist approval and revocation events in an append-only, integrity-protected store. Each approval must bind to:

- exact skill ID and version;
- exact canonical artifact digest;
- exact evaluation digest and rubric digest;
- exact assignment-set digest;
- permitted promotion transition and environment;
- approver identity and policy version;
- issuance time, expiry, and unique nonce.

A mutable process-local capability is only a short-lived in-memory result of verification. After process restart, the host must reload and reverify the durable approval record.

### 3. Revocation and supersession

Revocation must be a durable event that references the exact approval ID and reason. Promotion and activation must check current revocation state at the time of use, not rely on a cached authorization object. A replacement artifact, rubric, evaluation, assignment set, or policy version invalidates the prior approval unless an explicit policy permits otherwise.

### 4. Concurrency and replay

Use transactional compare-and-swap or equivalent locking to ensure that two workers cannot consume the same one-time promotion nonce or activate conflicting versions. A verifier timeout, storage error, unknown schema, or unavailable revocation source must fail closed.

### 5. Separation from execution authorization

Skill promotion only establishes that a particular skill version passed its assessment and was approved for a defined assignment. It does not authorize:
- running generated tools;
- accessing files, network, devices, credentials, or external targets;
- bypassing sandbox policy;
- changing APEX/Director decisions;
- submitting or issuing signed Evidence;
- starting or resuming East/e3 workflows.

Every consequential operation must still pass the independent APEX/Director authorization and East/e3 workflow gates. BridgeGate continues to authorize trusted origins and messages. ExploitGym remains the isolated evaluation boundary. Model outputs, retrieved pages, skill instructions, and evaluation evidence remain untrusted data until validated by the appropriate host service.

## Required tests before production activation

- Approval from an unauthenticated or mismatched principal is rejected.
- Approval digest mismatch is rejected for artifact, rubric, evaluation, assignment set, policy version, or transition.
- Expired, revoked, superseded, and replayed approvals are rejected after process restart.
- Two concurrent workers cannot consume the same one-time approval.
- Storage outage, corrupt record, unsupported schema, and unavailable revocation service fail closed.
- A valid skill promotion cannot invoke a tool or bypass the independent APEX/East gates.
- Audit history remains append-only and records approval, rejection, revocation, and supersession without copying secrets or full model prompts.

## Release gate

Do not wire the lifecycle into `apps/web/directorRuntime.ts` or enable automatic promotion until authenticated approval, durable storage, revocation checks, and a network-denied disposable sandbox are independently implemented and reviewed. The current runtime intentionally lacks those host services and must continue to fail closed.

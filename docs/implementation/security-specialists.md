# Security specialists: implementation notes

Design: `docs/architecture/Security-Research-Specialists-v1.1.md`.

## Code map
- `packages/intelligence/agents/AgentManager.ts`: `SECURITY_SPECIALIST_TEMPLATES`, `SecuritySpecialistId`, `releaseSpecialist()`.
- `packages/intelligence/agents/specialists/dynamicCatalog.ts`: narrower named roles. Routing does not select them, and `assemble` does not accept them. A catalog entry is not permission.
- `packages/intelligence/skills/SkillRegistry.ts` + `skills/catalog.ts`: the Layer 1-5 capability matrix (networking through AI/application security) as data, validated against known specialists and core agents. Holds no tool access.
- `packages/intelligence/security/routing.ts`: `routeSecurityTask()`.
- `packages/intelligence/security/tools.ts`: `ToolRegistry` describes which specialists may *request* which tools. It does not launch them. Offensive assessment toolkits are not in the catalog. An "active" tool still needs a per-use human approval before the delegation gate will allow the request.
- `packages/intelligence/security/delegation.ts`: `DelegationGate`, `DelegationVoucher`, `VoucherVerifier`.
- `packages/intelligence/security/SecurityDivision.ts`: team assembly and tool-use requests. `requestToolUse` now runs three independent checks before the gate: active team membership, `ToolRegistry.mayRequest`, and (for "active" tools) a verified per-use approval.
- `packages/intelligence/security/evidence.ts`: `buildEvidenceReport()` builds a findings write-up (classification, affected component, repro steps, remediation, confidence) exclusively from entries the delegation gate already recorded. It throws `EvidenceReportError` if there is no gate-allowed entry for the task, rejects reproduction steps that look like exploit code, and caps confidence at "medium" unless an independent Validator confirmation is passed in. Confidence is never a free-text field a caller can set directly.
- `packages/intelligence/policies/apexPolicies.ts`: `evaluatePolicy()` is a fail-closed lookup. Analysis and gated tool-use requests are the only permitted classes. Consequential execution, authorizing a target, expanding scope, self-approval, overriding a human, and manufacturing evidence are forbidden. Unknown names, including `"toString"`, are forbidden. The table does not set `authorized` and is not a trust contract.
- `packages/intelligence/tasks/TaskOwnership.ts`: AI-owned and user-owned tasks are separate. An AI actor cannot mutate a user-owned task. No capability handler runs here.
- `Orchestrator.security`: a `SecurityDivision` created with a default-deny gate.

## Usage
```ts
const orchestrator = new Orchestrator({
  inference,
  getResources
  // Omit delegationGate and approvalVerifier to fail closed.
});

const team = await orchestrator.security.assemble(taskId, "Review Entra ID conditional access");
try {
  const decision = await orchestrator.security.requestToolUse(team, agentId, tool, scopeRef, voucher);
  // decision.allowed is this gate's boolean. It is not APEX `authorized`.
  // This package does not execute the tool.
} finally {
  team.release();
}
```
Without an injected verifier and approval checker, all tool requests are denied and
operational-intent tasks are refused. No verifier ships in this repository.

## Tests
`npm run test:engine` runs `security-routing`, `security-delegation`,
`security-division`, `security-orchestrator`, `security-evidence`,
`skill-registry`, `tool-registry`, and `apex-policies`, alongside the
existing suites.

## What a report can and cannot claim
`buildEvidenceReport` is intentionally strict about what counts as evidence:
it reads only `DelegationAuditEntry` rows the gate itself wrote (never a
caller-supplied "signature"), requires at least one `allowed: true` entry for
the exact task id, and will not raise confidence past "medium" without an
explicit `validatorConfirmed: true` -- an agent's own account of its own
finding is never enough on its own. This is the direct counter to a pattern
worth naming: a module that calls `Math.random()` to produce a string that
*looks* like a cryptographic signature is not evidence of anything, and this
design has no path that could produce one.

## Known limitations
- **Routing is a keyword heuristic**, not semantic understanding. It can misroute
  or miss; an unmatched task falls back to the core `security` agent.
- **Operational-intent detection is a heuristic speed bump, not a control.** It
  matches action phrases and will have false positives and false negatives. The
  real controls are the approval verifier and the delegation gate.
- **Replay protection is in-memory and per process.** Used voucher ids are
  forgotten on restart and are not shared across instances.
- **The audit log is in-memory and unsigned.** It is not an APEX evidence record.
- **No concrete verifier ships here.** This package does not add a trust contract,
  a signature scheme, RLS, or schema. `decision.allowed` is not `authorized`.
- **No tool runner ships here.** A catalog entry is not an adapter.
- Specialists are not part of the `executeTask` deliberation stages.

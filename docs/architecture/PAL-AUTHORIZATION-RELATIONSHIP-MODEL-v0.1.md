# PAL Authorization Relationship Model v0.1

## Purpose

Extend the synthetic Security World Model with explicit role-to-permission, resource-ownership, route-to-operation, and authorization-invariant relationships. The goal is to reason about authorization logic without treating a missing source-code signal as proof of access or denial.

## Model

The immutable `AuthorizationRelationshipModel` layers on a validated `SecurityWorldModel` and contains:

- Role permission grants: role, action, resource kind, explicit allow/deny effect, confidence, and evidence reference.
- Ownership rules: operation-specific `owner-only`, `not-required`, or `unknown` requirement with provenance.
- Route bindings: source-inventoried route path/methods mapped to a modeled operation with provenance.
- Inventory completeness: permission and ownership inventories are explicitly `complete` or `partial`.
- Invariants: tenant isolation and owner-only writes.

## Decision semantics

1. An explicit deny grant takes precedence over an allow grant.
2. A non-owner is denied by an explicit owner-only rule.
3. A base operation's residual authorization deny is decisive; unknown residual authorization remains unknown.
4. An enforced tenant guard denies cross-tenant access; an unknown tenant guard makes the cross-tenant decision unknown.
5. A matching explicit allow grant can authorize a modeled role/action/resource-kind tuple only after applicable ownership and tenant controls are accounted for.
6. If no matching grant exists, a complete permission inventory means deny; a partial inventory means unknown.
7. If no ownership rule exists, a complete ownership inventory means no owner-only restriction was inventoried; a partial inventory means unknown.

Unknown is never converted to deny or allow. All combinations are bounded by the existing 100,000-state model limit.

## Outputs

The checker returns counterexamples only when the supplied relationships explicitly predict allow and that allow violates an invariant. Each counterexample retains the operation, principal, resource, role, tenant/owner relationships, and evidence references from grants, ownership rules, route bindings, and world facts.

- `counterexample`: an explicit modeled allow violates an invariant.
- `no-counterexample`: all evaluated pairs are decisive and no modeled violation exists.
- `inconclusive`: one or more decisions depend on incomplete or unknown relationships, or no invariant was supplied.

Every result remains `findingStatus: unverified`, `authorized: false`, and `executionPerformed: false`.

## Limitations

- This is a finite synthetic/source-evidence model, not a runtime authorization oracle.
- The model depends on the accuracy and completeness declarations of its inputs.
- It does not infer framework middleware, policy inheritance, identity-provider claims, database row-level security, or dynamic policy evaluation.
- Route bindings preserve traceability but do not prove route reachability.
- It does not execute source or contact targets.

## Governance

APEX/Director remains the authority for scope and approvals. The relationship checker can propose counterexamples only; it cannot authorize tests, invoke tools, modify applications, or issue trusted receipts. East/e3, ExploitGym, BridgeGate, RuntimeController, LlamaEngine, and signed evidence boundaries remain unchanged.

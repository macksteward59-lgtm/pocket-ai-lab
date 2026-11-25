# Director Cycle — Runtime Boundary Review (2026-11-24)

## Scope and evidence

Read-only review of Pocket AI Lab main at `fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873`, PR #302 (`codex/owned-runtime-prevention`, head `1d4dd0bd37d9541aa1dfb4931343a0d578b0e216)), its workflow, fixture runner, offline verifier, and regression tests. No candidate code was executed in this cycle.

PR #302's hosted governance-sidecar run #45396979207 passed. The workflow tests an owned Node fixture on Ubuntu and Windows, verifies a saved evidence bundle in a second process, and uploads the bundle. It is still a draft; no review is recorded.

## Verified boundary

The demo uses Node's process permission flags to prevent its trusted fixture writer from modifying one protected file while permitting a control-file write. It correlates two fixture reports, derives a file-scoped rule, records a local synthetic alert, and checks expected bytes and digests.

This is a useful regression demonstrator for accidental writes by the bundled writer. It is **not** malware detection, OS endpoint protection, an external alert, or a sandbox for hostile generated code. The evidence bundle is unsigned; a digest supplied separately detects alteration relative to that saved digest, but does not authenticate the producer.

Node's official permission documentation explicitly states that the permission model is a “seat belt” for trusted code and does not provide security guarantees against malicious code: https://nodejs.org/download/release/v22.17.0/docs/api/permissions.html

## Safe next increment (design only)

1. Keep this fixture and its positive/negative cases as a narrow runtime-prevention test.
2. Before admitting untrusted code, require a separate disposable OS/container boundary: no network, read-only base, dedicated non-root identity, minimal writable scratch mount, dropped capabilities, hard CPU/memory/PID/time/output limits, and verified cleanup.
3. Keep policy derivation and evidence grading outside the candidate process. Bind evidence to run ID, immutable source digest, exact scope, and independently observed outcome.
4. Treat alerts as local, unsigned review artifacts until a separately approved signing and delivery design exists. Do not grant automatic remediation or APEX/East authority from a fixture signal.
5. Add an explicit negative claim to documentation and UI: “Node permissions alone are not a hostile-code sandbox.”

## Integration status

- Mainline latest commit remains `fb59f76...`; main's last recorded CI is failed for the known East lifecycle import/export mismatch (runs #44457509006 and #44457508945, Nov 19).
- PR #302 passes its focused workflow but remains unmerged and draft.
- PR #301's local Trivy JSON importer is a draft review-only feature; it does not invoke a scanner or publish findings. Its general/consumer CI remains blocked by the same East integration failure.
- No PR, deployment, active target test, permission change, or credential use is authorized by this note.

## Next review gates

- Review PR #302's exact-head CI and evidence artifact, including unsigned-bundle threat model.
- Repair East imports in a minimal independent branch rather than importing the oversized #157 stack.
- Enforce host-issued, task-digest-bound approval at every external dispatch entry point.
- Keep security research strictly within the named authorized program scope or local/Academy lab.

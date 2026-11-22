# Pocket AI Lab — Owned two-tenant business-logic fixture v1

**Scope:** Exact synthetic local fixtures only. **Implementation state:** a real, loopback-only Node HTTP server, restrictive client, independently specified test oracle, and self-consistency journal. Does **not** provide APEX authorization, an external-target scanner, a sandbox, ExploitGym integration, model inference, a screenshot capture, an iPhone run, or signed evidence.

## Why this exists

The source review in [draft PR #267](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/267) established that visual evidence needs a real server-side authorization oracle. A screenshot or accessibility tree can show a wrong-state UI, but cannot independently prove the underlying authorization failure. Existing [ProofHunt #139](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/139) produces **authorization plans, never execution**; [scope preflight #183](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/183) validates constraints but grants no permission; [quarantine metadata #184](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/184) does not verify artifact bytes. Those are current draft feature branches, not merged main APIs.

This deliberately separate test tool gives future integration work a frozen, runnable benchmark with both a negative control and a known positive flaw. It does not copy or alter the authority of Director/APEX, East/e3 or ExploitGym.

## Run

Requirements: Node.js 22 or newer. No package installation and no network access outside the test process' **127.0.0.1** loopback needed.

From the repository root:

```sh
node --test tools/security-fixtures/tenant-workflow-v1/run.test.mjs
node tools/security-fixtures/tenant-workflow-v1/run.mjs
```

The test binds the operating system's loopback IPv4 address at a randomly assigned local port, then closes it after each case. There are no external requests, target hostnames, credentials, long-running services, Docker workloads, browser automation, or artificial screenshots. The `run.mjs` demo completes **7 actual HTTP requests** in each mode, 14 total, then exits. The test suite performs additional isolated local requests. This should not be deployed as an Internet-accessible service.

## Deterministic business-logic test

Two known synthetic actors and two seeded invoices:

| Actor | Tenant | Owned invoice | Initial status/version |
|---|---|---|---|
| `alice` | `alpha` | `invoice-alpha` | `pending` / `1` |
| `bob` | `beta` | `invoice-beta` | `pending` / `1` |

Two server variants differ in **one** access decision:

- `enforced`: requires actor tenant = route tenant **and** invoice owner = route tenant. Alice's request to `/api/tenants/alpha/invoices/invoice-beta` is denied. Neither read nor approval changes Beta's invoice.
- `intentionally-flawed`: requires only actor tenant = route tenant, omitting the invoice owner invariant. The same Alice request can expose and approve Beta's invoice. Bob then observes it became `approved` at version `2`. The fixture is a controlled positive regression, not an attack against any third party.

The host-side test client constructs exact known paths only, requires literal IPv4 loopback, uses a bounded per-cycle request budget, never follows redirects, and supports cancellation. It does **not** prove that a loopback endpoint is actually owned if an untrusted caller supplies an arbitrary origin; production callers must obtain the exact destination from trusted host-created fixture state, not model output. Fake `x-fixture-*` headers are local test markers, **not authentication**, and must never become production authorization controls.

The independent `oracle.mjs` knows the synthetic tenant ownership invariant but does **not** inspect the fixture server mode. It requires both a forbidden cross-tenant read and state-changing approval, verifies Bob's before/after readback and legitimate operations/replay negative controls, and returns one of: `negative-control-passed`, `synthetic-flaw-reproduced`, or `inconclusive`. A mismatched task ID, missing control, or inconsistent state cannot be promoted as proof. Positive results are **synthetic fixture results only**.

The `journalFor()` routine records ordinal, previous hash, immutable JSON payload and SHA-256 digest. It rejects accidental tampering/reordering or missing earlier events. These are **self-consistency hashes, not signed, externally anchored, append-only storage or device attestations**. A malicious actor who can replace the whole report and recompute hashes can forge it. Actual evidence admission requires independent root anchoring and trusted-host verification.

## Next integration slice — not implemented here

1. Use the [existing ProofHunt draft](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/139) only for verified **plan** admission; obtain separate, fresh, action-bound APEX permission at the trusted host before any protected dispatch. A successful program-scope match is not permission.
2. Bind an East/e3 durable task ID, cancellation, idempotency key and resource reservation to each exact fixture call. A crashed or interrupted attempt must be recorded as uncertain rather than silently retried.
3. Admit bytes through a trusted quarantine intake, verify actual file bytes/hash, redaction and external-data classification, and store provenance before evaluation. The #184 metadata-only draft is insufficient for that.
4. Run the owned cases under ExploitGym's real isolated adapter and its independently graded held-out fixtures; do not assume this standalone loopback server is a sandbox.
5. Add a bounded local browser trace adapter using **both** screenshot bytes and accessibility/DOM tree, plus sanitized network summary and this same oracle. Integrate the proposal in #267 without duplicating its evidence contract; a screenshot alone is never sufficient to prove backend access.
6. Attach Critic and Validator independently; report disagreement and keep negative evidence. Include a baseline comparison (code-only deterministic oracle vs model-generated hypotheses) before promoting a new model or harness.
7. Keep final disclosure, signed runtime evidence, physical iPhone Air model readiness, live program authorization, host networking and release acceptance as separate gates.

### Acceptance gates and failures exercised

- Protected case denies both Alice-to-Beta read and versioned approval; Beta's state remains pending.
- Flawed positive case reproduces both cross-tenant read and unauthorized state transition; Bob's readback confirms the state mutation.
- Legitimate own read/approval succeeds, duplicate approval returns `409`, and malicious actor/tenant/path/method controls fail closed.
- Unknown hosts, URLs with credentials/query strings, hostname lookalikes and HTTP redirects are rejected; no public network requests are made by the fixture test.
- Client enforces request count even under parallel admission, cancellation remains supported, task IDs are linked, and hash-chain checks detect ordinary tampering.
- Reports explicitly label `apexAuthorization`, `eastDurability`, `exploitGym` as `not-integrated`, `modelRuntime` as `none`, and `screenshotCapture` as `none`.

### Operational limitations

- Real loopback HTTP is demonstrated; native iOS, remotely hosted agents, browser/screenshot processing, signed evidence, network-isolated sandbox and production security authorization are **not**.
- No T0–T4 module permissions, original M01–M42 descriptions or RLS v3.12 authority are inferred. Recover primary sources before changing those trust boundaries.
- No code in existing product runtime files is modified. Tests are for the new tool directory only; a passed test does not imply systemwide CI success.
- All synthetic paths and user identifiers are invented for testing and do not identify real users.


## Legitimate privileged auditing — false-positive negative control (v1 follow-up)

The original enforced/intentionally-flawed two-tenant seven-request baseline is unchanged. A *separate*, deliberately legitimate privileged read workflow now models the kind of context-sensitive exception a security agent must **not** automatically call a vulnerability. The synthetic `auditor` actor may read both alpha and beta invoices via an explicit `/api/audit/invoices/:invoiceId` **read-only** endpoint, in *both* fixture modes. Ordinary tenant actors cannot use this endpoint. The auditor cannot use tenant-specific API routes and cannot mutate invoices via `/approve`. This is a toy fixture using fake headers, not a production identity system or permission grant.

The new independently specified `assessAuditSequence` oracle checks five actual loopback HTTP responses, including read-only controls and state readback. It marks a matching admin-audit sequence as `legitimate-admin-control-passed` with `confirmedFinding:false`; malformed or inconsistent observations are inconclusive, not automatically safe. A false-positive study should present the admin behavior alongside deliberately flawed tenant behavior **without giving the model the answer**, and independently score whether a proposed agent flags only the actual cross-tenant authorization defect. No agent/model inference has been run yet.

Run from the repository root:

```sh
node --test tools/security-fixtures/tenant-workflow-v1/*.test.mjs
node tools/security-fixtures/tenant-workflow-v1/admin-control.mjs
```

The audit-control demo makes **5 local loopback requests per fixture mode** (10 total). It never contacts public targets or uses third-party screenshots. Both modes preserve beta's invoice as pending in the audit-only sequence. A full-model benchmark requires frozen prompts, unseen trials and independent scoring before citing false-positive rates; passing this deterministic oracle is not a claim of general AI security capability.

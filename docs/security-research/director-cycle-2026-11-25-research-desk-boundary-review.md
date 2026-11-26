# Director Cycle — Research Desk Boundary Review (2026-11-25)

## Scope and method

Read-only source review of main at `42de73ff6a41ef752770133899f52dd9f840f557`, specifically `docs/research-desk/index.html`, plus the latest available main-derived CI logs for PRs #301 and #302. No JavaScript from the Research Desk was executed. No public target was contacted. No credentials or external integrations were used.

This note is a design/security review, not a claim that the static fixture is deployed or exploitable.

## Verified repository and CI state

- Main moved from `fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873` to `42de73ff6a41ef752770133899f52dd9f840f557` on 2026-11-25.
- The new main commit adds only `docs/research-desk/index.html` (384 lines); no workflow run was associated with that docs commit.
- PR #302 main-derived intelligence CI run #45396978763 failed at TypeScript build; Consumer CI run #45396978785 also failed.
- PR #301 main-derived intelligence CI run #45375626135 failed at TypeScript build.
- Exact compiler causes in `packages/intelligence/__tests__/autonomy.test.ts`: missing `EastTaskLifecycleAdapter`, missing `TaskLifecycleCoordinator`, and missing `EastRuntimeCheckpoint` export from `src/east/platform`. The dependent implicit-any errors follow from unresolved imports.
- This is a recurring failure; stop repeating identical reruns until the dependency mismatch is repaired.

## Research Desk static-fixture review

Source: `docs/research-desk/index.html` at the main commit above.

### Safe behavior confirmed by source

- The page defines a fixed fictional program, `Lumen Internal Fixture`, with `fixture.lumen.local` and `api.lumen.local`; all other hosts default-deny.
- The page explicitly states that no live host is contacted and its submit button does not submit externally.
- The reviewed file contains no fetch/XHR/WebSocket or network-dispatch implementation. All visible state changes are in-page JavaScript.
- This is therefore a static local demonstration, not an active recon tool, report publisher, or real authorization service.

### Risks if the prototype is promoted or reused

1. **Authorization is only a UI checkbox.** `state.authorized` is browser-local state. It is not a signed, server-verified approval and is not bound to a task, target, branch, expiry, or actor. Do not treat it as an execution gate.
2. **Budget is client state.** The `raise` button changes a local counter. It demonstrates UI behavior, not an APEX budget ledger or independent approval.
3. **Signature label is inaccurate.** `draftIris()` creates a result with literal `signed: true` and a hard-coded digest string; no cryptographic signature or digest computation is performed. The UI labels it “Signed.” Change the display to “Unsigned fixture draft” unless real signing and independent verification are implemented.
4. **Scope path matching is prefix-based.** `checkScope()` allows a path when it equals an allowed path or starts with that path plus `/`. This is not canonical URL/path validation. Encoded separators, dot-segments, normalization differences, query handling, and downstream router behavior must be resolved before this function is reused as an enforcement boundary. The present fixture has no network dispatch, so this is a future integration risk, not a demonstrated live bypass.
5. **Evidence is illustrative.** The findings and request/response strings are hard-coded; they are not captured from a test run. The UI should label them as synthetic fixture evidence and avoid implying independent reproduction.
6. **Agent names are role labels.** The “Claude/Grok/OpenAI” entries are static UI data, not running or delegated agents. The interface must not claim live agent execution.

## Safe next increment

- Keep this page under `docs/` and mark every simulated control and evidence object as fixture-only.
- Replace “Signed” with “Unsigned fixture draft”; reserve signed status for a signature verified by a trusted key outside the candidate/browser process.
- Replace the authorization checkbox with a non-authoritative preview control. Any future dispatch must require a host-owned approval verifier over canonical task/target/branch/operation/budget/expiry/nonce fields.
- Treat client budget and task status as display-only; enforce resource budgets in the trusted host.
- For future scope evaluation, canonicalize host and path with a documented parser, reject ambiguous encodings and traversal, normalize before exact allowlist matching, and test adversarial equivalence cases. Do not permit model output to add hosts or paths.
- Preserve the current “no external submission” property. A report export should be a local draft requiring explicit human review, not a direct program submission.
- Add a clear banner: “Synthetic fixture; not an authorization service, signature system, live agent, or hostile-code sandbox.”

## Review gates

- Review the exact main commit and this note.
- Keep the Research Desk static until the authorization, evidence authenticity, scope canonicalization, and durable-state contracts are independently implemented and tested.
- Repair East lifecycle imports in a small separate branch; do not import the full stacked PR #157 to fix this build.
- No PR, merge, deployment, active target testing, or permission/configuration change was performed in this cycle.

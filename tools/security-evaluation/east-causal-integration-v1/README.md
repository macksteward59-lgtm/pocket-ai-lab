# East + causal review: pinned composite acceptance smoke

This is a **test-only** continuation of the Red Team Ecosystem work under owner issue #255. It joins unchanged sources from draft PR #157 (East lifecycle/agent runtime) and draft PR #281 (owned synthetic causal review and post-run answer-key verification). It does **not** duplicate the lifecycle implementation, replay PR #273's PostgreSQL 15/16 validation, change product code or merge dependency branches.

## Source pins and assembly

- East lifecycle source: commit `ab2ad101d1a2ebfa277bd2c136db79b6b1afc094` (draft PR #157).
- Owned causal review source: commit `e42467012abefe3d5f6083ab6dbfcdbe9f9a148f` (draft PR #281).
- This branch contributes only this smoke test and a pinned, read-only hosted workflow.
- GitHub Actions reconstructs a composite checkout of the above source without modifying either original branch. It refuses file-path overlaps, prints the composite Git tree, installs Node dependencies with scripts disabled, compiles TypeScript, runs existing East autonomy contracts, and runs the new joined test.

## Independent new assertions

1. A *scripted* owned 127.0.0.1 counterfactual (not a new real-model trial) produces a host-only post-run key. A separate offline reader validates the public model task, original mock response, witness, patched behavior, and source-level score.
2. The host then gives only a **non-authorizing review summary** to the existing East 8-agent runtime using an injected inference test double. Even a generated “verified” or “approved” statement must not grant APEX authority.
3. The intended cross-tenant auditor **read** is graded as a false positive, not reported as a genuine source defect or as permission.
4. After replay through a fresh East runtime and durable lifecycle-store interface, completed agent inference is not generated again. This checks API-level recovery against the in-memory store contract, **not** a real database crash/restart.
5. If the post-run key is corrupted, the host gate refuses to launch East work.
   
## Critical limitations

This is a cross-source CI **integration smoke**, not actual app integration. It does not run a physical iPhone, real model, external security target, ExploitGym container, APEX authorization service, RLS-protected production database or durable production storage. Synthetic task headers are not authentication. Unsigned evidence can be replaced wholesale and is not hardware attestation. No model-performance, human-bounty-baseline, generalization, release, merge or deployment claim is justified. All parent PRs remain draft. Any real execution requires separate existing Director/APEX authorization and scope receipts; this test never supplies them.

**Local reproduction:** the workflow file is the canonical pinned assembly recipe. It must run within the reconstructed East checkout; the #281 branch alone deliberately does not duplicate the missing mainline East source.

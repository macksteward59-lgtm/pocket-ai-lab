# PostgreSQL 15 and 16 execution of the v3.12 §2 privilege monitor

November 22, 2026 · Pocket AI Lab · V71a–f

The SQL from the owner's specification failed during view creation on PostgreSQL 15.20 and 16.16. Both engines returned SQLSTATE `42883` for `has_privs_of_role(oid, oid)`. The policy matrix installed, but the view was absent afterward. V71a failed on each engine. V71b–f could not run against the original.

The candidate replaced the single owner-role lookup with `pg_catalog.pg_has_role(u.oid, c.relowner, 'USAGE')`. The two arguments are the role being evaluated and the table owner's OID. PostgreSQL documents this predicate as testing whether another role's privileges are immediately available. [PostgreSQL 15 role functions](https://www.postgresql.org/docs/15/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE) · [PostgreSQL 16 role functions](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE)

| Owner's case | Observed result from the candidate | PG 15.20 | PG 16.16 |
| --- | --- | --- | --- |
| V71a · Clean installation | Installed, returned the five expected columns and zero rows | Pass | Pass |
| V71b · Allowed column update | Re-granting the already effective permission yielded zero rows | Pass | Pass |
| V71c · Unexpected column update | One finding identified the role, column and privilege | Pass | Pass |
| V71d · Public table grant | One finding identified PUBLIC and SELECT | Pass | Pass |
| V71e · Missing table | One finding named the missing table. The view remained queryable | Pass | Pass |
| V71f · Indirect table privilege | The intermediate role was labeled direct. The inheriting role was labeled unknown, as permitted by V71f | Pass | Pass |

Two additional controls exercised the changed expression on both engines. A synthetic role that inherited the table owner's privileges produced 12 owner-attributed rows across three tables and four privilege types. With inheritance disabled before the same membership grant, membership remained true, the owner's privileges were unavailable, and the role produced zero owner-attributed rows.

## What a clean result establishes

The expected update permission on the monitored column produced zero findings when present and zero when withdrawn. A separate effective-permission check distinguished those states. This view detects deviations of specified kinds. The release evidence also needs positive checks wherever the application depends on a grant actually existing.

The matrix names four relations. The view watches three. Their only shared relation is `breakglass_grants`. The other matrix relations are `redemption_tickets`, `migration_repair_authorizations`, and `approver_registry`. V71a–f provide no acceptance evidence for those three. Their intended coverage needs explicit mapping to a monitor and a test.

## Reproduction and next acceptance step

We verified SHA-256 fingerprints for both original SQL blocks against the owner-authored project conversation. Two fresh native PostgreSQL clusters ran in stand-alone mode using synthetic tables and no network listener. A fixture administrator prepared the roles and tables. The schema owner installed the view. A non-superuser role without RLS bypass queried it. Every case ran in a rolled-back transaction. The evidence includes the exact engine versions, checksums, original diagnostic, result types and finding rows. [Machine-readable results](v71-postgres-results.json)

The repository's next integration test should apply the candidate migration as the intended schema owner in normal client/server mode and repeat these cases through a restricted connection. It should also verify each required permission and record which monitor covers each declared relation. The existing release assessment remains open. [Twelve-section release review](README.md)

## Hosted integration in draft PR #271

The [candidate migrations](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/271) at `5f0706202c326f39db7260c9e21793942b2faa44` passed the six original cases and all additional checks through a schema-owner login and an independent, restricted observer. GitHub recorded 36 passing assertions on [PostgreSQL 15.20](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45026710895/job/137221220141) and 36 on [PostgreSQL 16.16](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45026710895/job/137221220274). Each job used a fresh server. Both returned to zero audit findings and all four direct fixture grants after the simulated changes.

The supplemental reports compare direct and effective grants for every matrix row, flag unlisted column grants on all four declared tables, and identify missing source-backed permissions. V71b assumes the mutator’s column grant is present. Section 4.3 explicitly specifies the ticket repair grant and forbids table-wide UPDATE. The preceding v3.11 §5.5 specifies the authorization-consumption grant. The registry-writer entry remains an allowance unless an additional source establishes that it must be installed. Tests also observed a table-level revoke remove the corresponding column grant and verified the monitor detected the loss before restoration. [PostgreSQL REVOKE documentation](https://www.postgresql.org/docs/16/sql-revoke.html)

The draft is unmerged. Two general checks fail on the base’s East lifecycle dependencies. The base references two missing TypeScript modules and a missing checkpoint export. [Consumer tests](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45026710800/job/137221219804) · [TypeScript build](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45026711035/job/137221221121). The named implementations appear together on [integration PR #159](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/159) at `30f414012dbfbd43ad84f28b714d8b1450388750`. Their integration is a separate review. No production deployment or whole-product acceptance was performed.

## Lifecycle dependency comparison

The November 18 [main commit](https://github.com/macksteward59-lgtm/pocket-ai-lab/commit/d68f97d894fff40785bed6d261223a93d5d82aa6) added the 920-line lifecycle test file by itself. Its two imported modules and the referenced checkpoint type were absent at the main revision tested by #271. Previous CI on #159 used an earlier suite.

To compare contracts, we checked out both candidates, ran their own lifecycle suite, then substituted the exact test file from main in a disposable checkout. Each original file was restored after the test. Both candidates compiled with their own tests. The local comparisons used Node 24.22.3, TypeScript 5.9.3 and Vitest 5.1.1.

| Runtime revision | Its own lifecycle suite | Exact suite from main | TypeScript with main’s suite |
| --- | --- | --- | --- |
| [#159](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/159) at `30f414012dbfbd43ad84f28b714d8b1450388750` | 19 of 19 passed | 19 of 30 passed | 49 diagnostics |
| [#157](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/157) at `ab2ad101d1a2ebfa277bd2c136db79b6b1afc094` | 30 of 30 passed | 29 of 30 passed | Passed |

The [earlier reconciliation](https://github.com/macksteward59-lgtm/pocket-ai-lab/commit/712e79c536a0fac788b1f2c3bcd936c12b9277be) contained the exact main test blob. The [following cancellation test change](https://github.com/macksteward59-lgtm/pocket-ai-lab/commit/95c072da33c87c6f5ef63c2e346aa0011a751b81) changed one case. In #157, requesting cancellation keeps an in-flight task running until the worker holding its lease confirms it has stopped. Late completion still fails. Main expects immediate terminal cancellation. That is the only test that failed when main’s suite ran on #157.

Git found one add/add conflict between #157 and #271, in that test file. Retaining #157’s version produced tree `fb224c7ecbacb06e25a54a463405b92ac60371d8`. Compared with #157, this tree adds the five database PR files and the main-branch leadership document. All existing runtime files are byte-identical to #157. [Draft #273](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/273) reconstructs that tree in CI from two pinned inputs and checks its Git hash before testing. Neither product branch was edited.

[Hosted replay](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45029043141/job/137228326465) on validation commit `da5ca85df1a2fa46546a177442b8bf966a7eac6a` verified the combined tree hash, passed `npm run build`, the 30-case lifecycle suite, the full repository `npm test` command, and 36 database checks on each of PostgreSQL 15.20 and 16.16. The regression command ran inside a container with external networking disabled. The archive smoke tests used ZIP tooling and the dependency cache populated during setup. The tracked inputs passed a final integrity check. Two optional live llama.cpp entries were skipped, one from source and one from compiled output. A live provider and a physical iPhone were outside this run. [Machine-readable local comparisons](lifecycle-compatibility.json)

Review #157's cancellation rule before combining the product branches. The build and test commands that failed directly on #271 passed on the reconstructed tree. #271 remains a separate draft against main, and its original check results still describe that base.

## Live model verification on the combined tree

[Draft #273](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/273) at `7a441b4acc7fd065fd42ca4db1302797b9a1bd5c` replayed the same tree, `fb224c7ecbacb06e25a54a463405b92ac60371d8`. The [Ubuntu x64 job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45032427133/job/137238716851) verified the CPU server archive for llama.cpp build 12233 (SHA-256 `9f4a78cc4e4c9f5a166102a43f1d8f8e4e9d75e76823eb9505d05bbba288abd5`) and logged upstream commit `5f490d7bf`. The existing project downloader verified the 105,454,432-byte SmolLM2-135M-Instruct Q4_K_M artifact (revision `09816acd5d99df7be770d85ea30822623dab342c`, SHA-256 `2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d`).

The server listened on loopback and reported the selected model ID. Both copies of the existing live test sent the same benign project-governance prompt through the completion adapter and accepted a nonempty text response with an analysis field. All 122 tests across the two provider suites passed. The server’s generated-token counter increased by 34 during those tests. The build, full offline regression, 30 lifecycle cases, and 36 checks on each of PostgreSQL 15.20 and 16.16 also passed. The final check found no tracked input changes. The [branch-only CI job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45032421839/job/137238700610) still fails to compile the two East modules absent from the PR base. The hosted result establishes server inference. A native app build, independently verified source answers and a signed physical-device run have separate acceptance criteria.

### Independent check of the same model on the frozen native benchmark

The [hosted Apple run for #269](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45031228658/job/137235059084) captured 36 requests for 12 synthetic private-fact cases, with the CPU requested and zero layers offloaded. Its [benchmark artifact](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45031228658/artifacts/14757654398) verified against GitHub's published ZIP SHA-256 `9cce5b0faeea040f22b84d78a3a66b35ebd832b98ccacb5e31aa8c0e960c9d36`. All 36 request IDs were unique. Four generations returned empty text. The other 32 returned text outside the frozen A/B answer format. Zero answers scored correct. The backend released its lease and reported zero reserved model memory afterward.

An independent row-by-row comparison found the manifest byte-identical and all 36 trial records identical to the [previous preserved run](https://github.com/macksteward59-lgtm/pocket-ai-lab/tree/4d8880d4a598f0c617b6d80afa42468d0ed6cfd1/docs/evidence/native-recipient-v1/44762948524) after omitting request ID and elapsed time. This reproduces the model limitation on these fixtures. The [existing raw/chat experiment](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/234) already tested both prompt formats and accepted zero strict A/B answers in either arm. Any candidate quality improvement should preserve this baseline and use the same frozen scoring on a separate result. Physical iPhone Air inference and the app’s evidence export remain open.

### Unsigned iPhone kit from the Apple-hosted build

The same [Apple job](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45031228658/job/137235059084) compiled the app for the simulator and generic iOS device, published its kit only after rebuilding from a fresh extraction, and compared the two packaged fixtures with the built app. The [downloadable kit](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45031228658/artifacts/14758936566) is from checkout `742f04e31b39a9b30d20181a6c9eaf71e63bbd24`, whose parents are #266 and #269 head `e53d7be0c8aac9b8515f834e6f40c58c3cf534cd`.

An independent inspection verified the GitHub ZIP digest `f65e50b4be2e0bd14cde6d0e19541c94d533c4b40e994b074b06ca919a5ad796` and inner tarball SHA-256 `4ee0f22caa9ede2bdfe1d6283a97d0aab701440fefb8c6d8d863ac37d3f32220`. The archive contained 231 entries, including the Xcode project and six frameworks with iOS arm64 slices. The passage fixture, project-source index, smoke-model pin and corrected recovery UI test matched four repository blobs. The kit contains source and built dependencies. Signing, a local GGUF import, actual offline generation and a returned evidence export on the owner's iPhone Air are still required. The GitHub artifact is scheduled to expire on November 29, 2026.

The native app XCTest subsequently passed on the iOS simulator. It imported the known source-answer fixture, corrected the answer, fully terminated the app, reopened it, checked the original and citation, and verified that retry left one record. The [exported review](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45031228658/artifacts/14759087783) has digest `ecc1bbb8c8228117316d6cfb344ed2a7455aa1da39f10576ddead9e7a3024290`. A second check downloaded the GitHub artifact, verified its ZIP digest `68002edc22ce60db6b4c460b982b916ade496a24e4e8fc1eace9f6b5a1fbcf44`, and ran the checkout's independent reader against the original fixture and project-source index. Both readers returned source `CF-QUOTA`, one owner revision, current answer `00:00 UTC`, original file matched, and `hardwareVerified: false`. The input was an imported example. The Apple-hosted benchmark's four empty generations and zero correct answers remain recorded separately.

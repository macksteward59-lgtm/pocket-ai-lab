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

# v3.12 §2 database privilege monitor

This candidate installs two versioned SQL files. Run them once in numeric order as the owner of the existing `app` schema. Each file is atomic and intentionally fails on an object-name collision. The files create audit objects and seed the four source allowlist entries. All application-role grants used to exercise those entries live in the disposable integration test.

| Object | Question it answers |
| --- | --- |
| `app.v38a_violations` | What deviations do the six source cases expose across the original three breakglass tables? |
| `app.v312_column_grant_inventory` | For each allowed matrix entry, do the named role, table, and column exist? Is the permission granted directly on the column? Is it effective through any path, and is the same privilege available at table level? |
| `app.v312_unlisted_column_grants` | Which explicit column grants on any matrix-listed table are outside the allowlist? PUBLIC column grants are always reported. The source exclusions for postgres and rdsadmin apply. |
| `app.v312_expected_grant_issues` | Which of three source-backed UPDATE expectations lost their allowance or direct grant? Does the repair executor effectively have the table-wide UPDATE forbidden for redemption tickets? |

V71b treats the mutator's update of `breakglass_grants.revoked_at` as already present. Section 4.3 explicitly grants the repair executor the update of `redemption_tickets.consumed_by_nonce` and excludes table-wide UPDATE. The preceding v3.11 §5.5 explicitly grants the repair executor the update of `migration_repair_authorizations.consumed_at`. The registry writer's `approver_registry.active_to` remains an allowance in this candidate. The original v3.12 matrix alone gives no mandatory-installation rule for it. The expected-grant report covers these three column grants and the explicit §4.3 prohibition. Full validation of repair policies and service behavior is separate.

The historical matrix/view fingerprints and original installation failure are recorded in the [two-version source review](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/198afea08aef1051d4102abde9284cc7af659d20/coordination/evidence/rls-v312-2026-11-22/V71-postgres.md). The candidate calls the documented owner-membership predicate and preserves the five-column result. The additional views report observations. An allowance alone says what access is permitted. The separate expected-grant report records the positive checks traced to the source; further deployment-specific expectations require their own basis. Effective column access can arise from a broader table grant. [PostgreSQL privilege inquiry functions](https://www.postgresql.org/docs/16/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE)

## Run the integration test

From this directory, run `python3 test_integration.py 15` and `python3 test_integration.py 16` on a host with Docker. Each run starts the official PostgreSQL image with networking disabled, imports the migrations through a non-superuser schema-owner login and queries the reports through a separate restricted login. Connections use the server's local socket and SCRAM. The test verifies V71a–f, the four provenance checks for direct and effective access, unexpected column grants on every declared table, inheritance and missing-table behavior. It removes its container on exit.

This directory has no automatic application startup or deployment hook. The migration assumes the trusted schema owner controls the `app` schema and the policy table. End-to-end release acceptance includes controls beyond this monitor.

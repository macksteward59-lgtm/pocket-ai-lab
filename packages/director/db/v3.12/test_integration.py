"""Test the candidate migrations in a fresh, network-isolated PostgreSQL server."""
import argparse
import os
from pathlib import Path
import secrets
import subprocess
import time

HERE = Path(__file__).resolve().parent
MIGRATIONS = ["001_privilege_monitor.sql", "002_column_grant_inventory.sql"]
OWNER = "app_schema_owner"
OBSERVER = "lab_observer"
POLICY = [
    ("approver_registry", "app_registry_writer", "active_to"),
    ("breakglass_grants", "app_breakglass_mutator", "revoked_at"),
    ("migration_repair_authorizations", "app_repair_executor", "consumed_at"),
    ("redemption_tickets", "app_repair_executor", "consumed_by_nonce"),
]
MONITOR = "app.v38a_violations"
INVENTORY = "app.v312_column_grant_inventory"
UNLISTED = "app.v312_unlisted_column_grants"
EXPECTED_ISSUES = "app.v312_expected_grant_issues"


def command(args, *, input_text=None, env=None):
    return subprocess.run(args, input=input_text, text=True, capture_output=True,
                          env=env, check=False)


def require(result, label):
    if result.returncode:
        raise RuntimeError(f"{label} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def verify(sql, major):
    def read(statement):
        return sql(OBSERVER, statement)

    def expect(label, actual, expected):
        if actual != expected:
            raise AssertionError(f"{label}: expected {expected!r}, observed {actual!r}")
        print(f"PASS {label}", flush=True)

    def grant_issues(table):
        return read(f"SELECT issue FROM {EXPECTED_ISSUES} WHERE table_name='{table}' ORDER BY issue")

    def finding(change, expected, restore, label):
        sql("postgres", change)
        try:
            expect(label, read(f"SELECT relname,rolname,privilege,source FROM {MONITOR} "
                               "ORDER BY relname,rolname,privilege,source"), expected)
        finally:
            sql("postgres", restore)

    def inventory(table):
        return read(f"SELECT direct_column_grant, effective_column_privilege FROM {INVENTORY} "
                    f"WHERE table_name='{table}'")

    expect("server major", sql("postgres", "SELECT current_setting('server_version_num')::int / 10000"), str(major))
    print("Engine", sql("postgres", "SHOW server_version"), flush=True)
    names = {role for _, role, _ in POLICY} | {"lab_member", "lab_group"}
    sql("postgres", "\n".join(f"CREATE ROLE {name} NOLOGIN;" for name in sorted(names)))
    sql("postgres", f"CREATE SCHEMA app AUTHORIZATION {OWNER}; GRANT USAGE ON SCHEMA app TO {OBSERVER};")
    expect("installer login", sql(OWNER, "SELECT session_user,current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user"),
           f"{OWNER}|{OWNER}|f|f")
    for table, role, column in POLICY:
        sql(OWNER, f"CREATE TABLE app.{table} ({column} timestamptz, expires_at timestamptz); "
                   f"GRANT UPDATE ({column}) ON app.{table} TO {role};")
    sql(OWNER, "CREATE TABLE app.breakglass_grant_approvers (id integer); CREATE TABLE app.breakglass_approvals (id integer);")
    for migration in MIGRATIONS:
        sql(OWNER, (HERE / migration).read_text())
    sql(OWNER, f"GRANT SELECT ON {MONITOR}, {INVENTORY}, {UNLISTED}, {EXPECTED_ISSUES} TO {OBSERVER};")
    expect("observer login", read("SELECT session_user,current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user"),
           f"{OBSERVER}|{OBSERVER}|f|f")
    expect("observer has only report access", read(
        "SELECT has_schema_privilege(current_user,'app','CREATE'),"
        "has_table_privilege(current_user,'app.column_privilege_matrix','UPDATE'),"
        "has_table_privilege(current_user,'app.breakglass_grants','SELECT')"), "f|f|f")
    expect("V71a columns and clean state",
           read(f"SELECT string_agg(attname || ' ' || format_type(atttypid,atttypmod),',' ORDER BY attnum) "
                f"FROM pg_attribute WHERE attrelid='{MONITOR}'::regclass AND attnum>0 AND NOT attisdropped") +
           "/" + read(f"SELECT count(*) FROM {MONITOR}"),
           "relname name,rolname name,privilege text,issue text,source text/0")

    table, mutator = "app.breakglass_grants", "app_breakglass_mutator"
    sql(OWNER, f"GRANT UPDATE(revoked_at) ON {table} TO {mutator}")
    expect("V71b allowed direct column", inventory("breakglass_grants") + "/" + read(f"SELECT count(*) FROM {MONITOR}"), "t|t/0")
    finding(f"GRANT UPDATE(expires_at) ON {table} TO {mutator}", "breakglass_grants|app_breakglass_mutator|expires_at:UPDATE|column",
            f"REVOKE UPDATE(expires_at) ON {table} FROM {mutator}", "V71c unexpected column")
    finding(f"GRANT SELECT ON {table} TO PUBLIC", "breakglass_grants|public|SELECT|PUBLIC",
            f"REVOKE SELECT ON {table} FROM PUBLIC", "V71d public table grant")
    # A removed table must be visible to an independently connected observer.
    finding(f"DROP TABLE {table}", "breakglass_grants|||missing",
            f"SET ROLE {OWNER}; CREATE TABLE {table} (revoked_at timestamptz, expires_at timestamptz); "
            f"GRANT UPDATE(revoked_at) ON {table} TO {mutator}", "V71e removed table")
    finding(f"GRANT lab_group TO lab_member; GRANT UPDATE ON {table} TO lab_group",
            "breakglass_grants|lab_group|UPDATE|direct\nbreakglass_grants|lab_member|UPDATE|unknown",
            f"REVOKE UPDATE ON {table} FROM lab_group; REVOKE lab_group FROM lab_member", "V71f indirect role")
    expect("matrix rows and direct permissions", read(
        f"SELECT table_name,role_name,column_name,privilege,direct_column_grant,effective_column_privilege "
        f"FROM {INVENTORY} ORDER BY table_name"), "\n".join(f"{t}|{r}|{c}|UPDATE|t|t" for t,r,c in POLICY))

    for t, role, col in POLICY:
        sql(OWNER, f"REVOKE UPDATE({col}) ON app.{t} FROM {role}")
        expect(f"{t} missing grant", inventory(t), "f|f")
        required_issue = "" if t == "approver_registry" else "missing_direct_column_grant"
        expect(f"{t} source expectation", grant_issues(t), required_issue)
        sql(OWNER, f"GRANT UPDATE ON app.{t} TO {role}")
        expect(f"{t} table-wide access", inventory(t), "f|t")
        if t == "redemption_tickets":
            expect("table-wide update cannot substitute for a repair column grant", grant_issues(t),
                   "missing_direct_column_grant\nunexpected_effective_table_update")
            sql(OWNER, f"GRANT UPDATE({col}) ON app.{t} TO {role}")
            expect("repair grant and broader table access both present", grant_issues(t),
                   "unexpected_effective_table_update")
        sql(OWNER, f"REVOKE UPDATE ON app.{t} FROM {role}; GRANT UPDATE({col}) ON app.{t} TO {role}; "
                   f"GRANT UPDATE(expires_at) ON app.{t} TO {role}")
        expect(f"{t} unlisted column", read(f"SELECT table_name,grantee,column_name,privilege FROM {UNLISTED}"),
               f"{t}|{role}|expires_at|UPDATE")
        sql(OWNER, f"REVOKE UPDATE(expires_at) ON app.{t} FROM {role}")

    sql(OWNER, f"REVOKE UPDATE(revoked_at) ON {table} FROM {mutator}; GRANT UPDATE(revoked_at) ON {table} TO lab_group")
    sql("postgres", f"GRANT lab_group TO {mutator}")
    expect("inherited column access", inventory("breakglass_grants"), "f|t")
    sql("postgres", f"REVOKE lab_group FROM {mutator}")
    sql(OWNER, f"REVOKE UPDATE(revoked_at) ON {table} FROM lab_group; GRANT UPDATE(revoked_at) ON {table} TO {mutator}")
    sql(OWNER, "ALTER TABLE app.redemption_tickets RENAME TO redemption_held")
    expect("missing relation remains in inventory", read(
        f"SELECT role_exists,table_exists,column_exists,direct_column_grant,effective_column_privilege IS NULL "
        f"FROM {INVENTORY} WHERE table_name='redemption_tickets'"), "t|f|f|f|t")
    sql(OWNER, "ALTER TABLE app.redemption_held RENAME TO redemption_tickets")
    sql(OWNER, "UPDATE app.column_privilege_matrix SET allowed=false WHERE table_name='redemption_tickets'")
    expect("required entry survives a missing allowance", grant_issues("redemption_tickets"), "missing_matrix_allowance")
    sql(OWNER, "GRANT UPDATE ON app.redemption_tickets TO app_repair_executor")
    expect("broader repair grant remains visible without its allowance", grant_issues("redemption_tickets"),
           "missing_matrix_allowance\nunexpected_effective_table_update")
    sql(OWNER, "REVOKE UPDATE ON app.redemption_tickets FROM app_repair_executor")
    sql(OWNER, "UPDATE app.column_privilege_matrix SET allowed=true WHERE table_name='redemption_tickets'")
    expect("revoking table UPDATE also removed its matching column grant", grant_issues("redemption_tickets"),
           "missing_direct_column_grant")
    sql(OWNER, "GRANT UPDATE(consumed_by_nonce) ON app.redemption_tickets TO app_repair_executor")
    expect("positive expectations restored", read(f"SELECT count(*) FROM {EXPECTED_ISSUES}"), "0")
    expect("clean after restores", read(f"SELECT (SELECT count(*) FROM {MONITOR}), (SELECT count(*) FROM {UNLISTED}),"
                                        f" (SELECT count(*) FROM {INVENTORY} WHERE direct_column_grant AND effective_column_privilege)"), "0|0|4")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("major", type=int, choices=[15, 16])
    major = parser.parse_args().major
    passwords = {name: secrets.token_hex(24) for name in ("postgres", OWNER, OBSERVER)}
    env = dict(os.environ, POSTGRES_PASSWORD=passwords["postgres"])
    image = f"postgres:{major}-bookworm"
    cid = require(command(["docker", "run", "--detach", "--rm", "--network", "none",
                           "-e", "POSTGRES_PASSWORD", "-e", "POSTGRES_INITDB_ARGS=--auth-local=scram-sha-256",
                           image], env=env), "start disposable PostgreSQL container")

    def sql(role, statement):
        result = command(["docker", "exec", "-i", "-e", "PGPASSWORD", cid, "psql",
                          "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", role, "-d", "postgres"],
                         input_text=statement, env=dict(os.environ, PGPASSWORD=passwords[role]))
        return require(result, f"psql as {role}")

    try:
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            # initdb runs a temporary postmaster before the entrypoint becomes postgres.
            if command(["docker", "exec", cid, "cat", "/proc/1/comm"]).stdout.strip() == "postgres":
                if command(["docker", "exec", cid, "pg_isready", "-q", "-U", "postgres"]).returncode == 0:
                    break
            time.sleep(1)
        else:
            raise RuntimeError("disposable PostgreSQL server did not become ready")
        for name in (OWNER, OBSERVER):
            sql("postgres", f"CREATE ROLE {name} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '{passwords[name]}'")
        verify(sql, major)
    finally:
        require(command(["docker", "rm", "-f", cid]), "remove disposable container")


if __name__ == "__main__":
    main()

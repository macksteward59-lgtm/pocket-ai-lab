-- Observations for every allowed matrix row. An allowance is not a requirement.
BEGIN;
SET LOCAL search_path = pg_catalog;

CREATE VIEW app.v312_column_grant_inventory AS
SELECT m.schema_name, m.table_name, m.role_name, m.column_name, m.privilege,
       r.oid IS NOT NULL AS role_exists,
       c.oid IS NOT NULL AS table_exists,
       a.attnum IS NOT NULL AS column_exists,
       EXISTS (
         SELECT 1 FROM aclexplode(a.attacl) acl
          WHERE acl.grantee = r.oid AND acl.privilege_type = m.privilege
       ) AS direct_column_grant,
       CASE WHEN r.oid IS NOT NULL AND a.attnum IS NOT NULL
                  AND m.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
            THEN has_column_privilege(r.oid, c.oid, a.attnum, m.privilege)
       END AS effective_column_privilege,
       CASE WHEN r.oid IS NOT NULL AND c.oid IS NOT NULL
                  AND m.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
            THEN has_table_privilege(r.oid, c.oid, m.privilege)
       END AS effective_table_privilege
  FROM app.column_privilege_matrix m
  LEFT JOIN pg_roles r ON r.rolname = m.role_name
  LEFT JOIN pg_namespace n ON n.nspname = m.schema_name
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = m.table_name
                       AND c.relkind IN ('r', 'p')
  LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = m.column_name
                           AND a.attnum > 0 AND NOT a.attisdropped
 WHERE m.allowed;

-- Compare explicit column ACLs on the declared tables to the same allowlist.
CREATE VIEW app.v312_unlisted_column_grants AS
SELECT t.schema_name, t.table_name,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END AS grantee,
       a.attname AS column_name, acl.privilege_type AS privilege
  FROM (SELECT DISTINCT schema_name, table_name FROM app.column_privilege_matrix) t
  JOIN pg_namespace n ON n.nspname = t.schema_name
  JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = t.table_name
                 AND c.relkind IN ('r', 'p')
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
 CROSS JOIN LATERAL aclexplode(a.attacl) acl
 WHERE acl.grantee = 0
    OR (pg_get_userbyid(acl.grantee) NOT IN ('postgres', 'rdsadmin')
        AND NOT EXISTS (
            SELECT 1 FROM app.column_privilege_matrix m
             WHERE m.schema_name = t.schema_name AND m.table_name = t.table_name
               AND m.role_name = pg_get_userbyid(acl.grantee) AND m.column_name = a.attname
               AND m.privilege = acl.privilege_type AND m.allowed
        ));

-- Source-backed UPDATE expectations are independent of the mutable allowlist.
-- v3.12 V71b assumes the mutator grant; v3.12 §4.3 and v3.11 §5.5
-- specify the repair grants. Only §4.3 supplies the explicit table-UPDATE prohibition here.
CREATE VIEW app.v312_expected_grant_issues AS
WITH expected(table_name, role_name, column_name, forbid_table_update) AS (
  VALUES ('breakglass_grants', 'app_breakglass_mutator', 'revoked_at', false),
         ('redemption_tickets', 'app_repair_executor', 'consumed_by_nonce', true),
         ('migration_repair_authorizations', 'app_repair_executor', 'consumed_at', false)
)
SELECT e.table_name, e.role_name, e.column_name, problem.issue
  FROM expected e
  LEFT JOIN app.v312_column_grant_inventory i
    ON i.schema_name = 'app' AND i.table_name = e.table_name::name
   AND i.role_name = e.role_name::name AND i.column_name = e.column_name::name
   AND i.privilege = 'UPDATE'
 CROSS JOIN LATERAL (VALUES
    ('missing_matrix_allowance', i.table_name IS NULL),
    ('missing_direct_column_grant', i.table_name IS NOT NULL AND NOT i.direct_column_grant),
    ('unexpected_effective_table_update', e.forbid_table_update AND has_table_privilege(
         to_regrole(e.role_name), to_regclass(format('%I.%I', 'app', e.table_name)), 'UPDATE'
     ))
 ) problem(issue, applies)
 WHERE problem.applies;

COMMIT;

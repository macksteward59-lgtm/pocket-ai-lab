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
       END AS effective_column_privilege
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

COMMIT;

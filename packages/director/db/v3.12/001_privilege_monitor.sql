-- Initial audit objects for the v3.12 section 2 candidate.
BEGIN;
SET LOCAL search_path = pg_catalog;

CREATE TABLE app.column_privilege_matrix (
  schema_name name NOT NULL,
  table_name  name NOT NULL,
  role_name   name NOT NULL,
  column_name name NOT NULL,
  privilege   text NOT NULL,
  allowed     boolean NOT NULL,
  PRIMARY KEY (schema_name, table_name, role_name, column_name, privilege)
);

INSERT INTO app.column_privilege_matrix VALUES
  ('app','breakglass_grants','app_breakglass_mutator','revoked_at','UPDATE', true),
  ('app','redemption_tickets','app_repair_executor','consumed_by_nonce','UPDATE', true),
  ('app','migration_repair_authorizations','app_repair_executor','consumed_at','UPDATE', true),
  ('app','approver_registry','app_registry_writer','active_to','UPDATE', true);

CREATE VIEW app.v38a_violations AS
WITH target_tables AS (
  SELECT unnest(ARRAY['breakglass_grants','breakglass_grant_approvers','breakglass_approvals'])::name AS relname
),
resolved AS (
  SELECT t.relname, c.oid AS rel_oid
    FROM target_tables t
    LEFT JOIN pg_namespace n ON n.nspname = 'app'
    LEFT JOIN pg_class     c ON c.relnamespace = n.oid AND c.relname = t.relname
),
missing_table AS (
  SELECT r.relname, NULL::name AS rolname, NULL::text AS privilege,
         'audit target table missing from catalog'::text AS issue, 'missing'::text AS source
    FROM resolved r WHERE r.rel_oid IS NULL
),
direct_or_owner AS (
  SELECT r.relname, u.rolname, p.privilege,
         CASE
           WHEN pg_get_userbyid(c.relowner) = u.rolname THEN 'ownership'
           WHEN EXISTS (SELECT 1 FROM LATERAL aclexplode(c.relacl) a
                         WHERE a.grantee = u.oid AND a.privilege_type = p.privilege) THEN 'direct'
           WHEN pg_catalog.pg_has_role(u.oid, c.relowner, 'USAGE') THEN 'inherited_from_owner'
           ELSE 'unknown'
         END AS source
    FROM resolved r
    JOIN pg_class c ON c.oid = r.rel_oid
    CROSS JOIN pg_roles u
    CROSS JOIN unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) AS p(privilege)
   WHERE u.rolname NOT IN ('postgres','rdsadmin')
     AND u.rolname NOT IN ('app_breakglass_mutator','app_schema_owner','app_repair_executor',
                           'app_registry_writer','app_telemetry_writer','app_ticket_consumer',
                           'app_session_binder','app_audit_writer','app_context_broker',
                           'app_authz_service')
     AND u.rolname NOT LIKE 'pg\_%'
     AND has_table_privilege(u.rolname, c.oid, p.privilege)
),
public_grants AS (
  SELECT r.relname, 'public'::name AS rolname, a.privilege_type::text AS privilege,
         'PUBLIC table privilege'::text AS issue, 'PUBLIC'::text AS source
    FROM resolved r
    JOIN pg_class c ON c.oid = r.rel_oid
    CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE a.grantee = 0
),
column_grants AS (
  SELECT r.relname, coalesce(u.rolname::text, 'public')::name AS rolname,
         (att.attname || ':' || a.privilege_type)::text AS privilege,
         'unexpected column privilege'::text AS issue, 'column'::text AS source
    FROM resolved r
    JOIN pg_class c ON c.oid = r.rel_oid
    JOIN pg_attribute att ON att.attrelid = c.oid AND att.attnum > 0 AND NOT att.attisdropped
    CROSS JOIN LATERAL aclexplode(att.attacl) a
    LEFT JOIN pg_roles u ON u.oid = a.grantee
   WHERE a.grantee = 0 OR u.rolname NOT IN ('postgres','rdsadmin')
     AND NOT EXISTS (
       SELECT 1 FROM app.column_privilege_matrix m
        WHERE m.schema_name = 'app'
          AND m.table_name  = r.relname
          AND m.role_name   = coalesce(u.rolname, 'public')
          AND m.column_name = att.attname
          AND m.privilege   = a.privilege_type
          AND m.allowed
     )
)
SELECT relname, rolname, privilege, issue, source FROM missing_table
UNION ALL
SELECT relname, rolname, privilege,
       CASE source WHEN 'ownership' THEN NULL
                   ELSE 'unexpected effective table privilege ('||source||')' END,
       source
  FROM direct_or_owner WHERE source <> 'ownership'
UNION ALL SELECT relname, rolname, privilege, issue, source FROM public_grants
UNION ALL SELECT relname, rolname, privilege, issue, source FROM column_grants;

COMMIT;

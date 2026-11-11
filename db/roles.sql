-- =====================================================================
-- PayTrust: database-level roles (least privilege)   (Member A)
--   mysql -u root -p paytrust < db/roles.sql
-- Application roles (user / admin) live in users.role and are enforced by the
-- stored procedures (_require_actor -> FORBIDDEN). This file adds MySQL
-- account roles so the database itself limits what each kind of login can do.
--
--   paytrust_app_role  what the Next.js server connects as: read/write the
--                      ordinary tables and CALL procedures. No DDL.
--   paytrust_auditor   read-only (SELECT) for reporting / reconciliation.
--
-- Money tables are never written directly by the app: ledger_entries and
-- transactions also have append-only triggers, so even this role cannot
-- UPDATE or DELETE them (LEDGER_IMMUTABLE).
-- Works on MySQL 8 and MariaDB 10.5+. Safe to re-run.
-- =====================================================================
CREATE ROLE IF NOT EXISTS 'paytrust_app_role', 'paytrust_auditor';

GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON paytrust.* TO 'paytrust_app_role';
GRANT SELECT ON paytrust.* TO 'paytrust_auditor';

-- Example accounts (change the passwords before using them):
--   CREATE USER 'paytrust_auditor1'@'localhost' IDENTIFIED BY 'change_me';
--   GRANT 'paytrust_auditor' TO 'paytrust_auditor1'@'localhost';
--   SET DEFAULT ROLE 'paytrust_auditor' FOR 'paytrust_auditor1'@'localhost';

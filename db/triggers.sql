-- =====================================================================
-- PayTrust: escrow status audit triggers (Member B)
-- Run after schema_escrow.sql:   mysql -u root -p paytrust < db/triggers.sql
--
-- Who made the change: the app sets the session variable @app_user_id
-- before touching escrows (see withActor() in lib/mysql.js). Stored
-- procedures run in the same session, so they see it too.
-- =====================================================================

DROP TRIGGER IF EXISTS trg_escrow_audit_insert;
DROP TRIGGER IF EXISTS trg_escrow_audit_update;

DELIMITER $$

-- Log the starting status when an escrow is created.
CREATE TRIGGER trg_escrow_audit_insert
AFTER INSERT ON escrows
FOR EACH ROW
BEGIN
  INSERT INTO escrow_status_audit (escrow_id, old_status, new_status, changed_by, db_user)
  VALUES (NEW.id, NULL, NEW.status, @app_user_id, CURRENT_USER());
END$$

-- Log every status change. Updates that leave status alone are not logged.
CREATE TRIGGER trg_escrow_audit_update
AFTER UPDATE ON escrows
FOR EACH ROW
BEGIN
  IF NOT (OLD.status <=> NEW.status) THEN
    INSERT INTO escrow_status_audit (escrow_id, old_status, new_status, changed_by, db_user)
    VALUES (NEW.id, OLD.status, NEW.status, @app_user_id, CURRENT_USER());
  END IF;
END$$

DELIMITER ;

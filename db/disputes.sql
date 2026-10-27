-- =====================================================================
-- PayTrust: dispute resolution procedure (Member B)
--   mysql -u root -p paytrust < db/disputes.sql
-- Load AFTER db/procedures.sql (it calls Member A's release_escrow and
-- refund_escrow). Re-running this file is safe.
--
-- resolve_dispute(escrow_id, decision, key)
--   The admin's decision on a disputed escrow:
--     'release' -> money goes to the seller   (A's release_escrow)
--     'refund'  -> money goes back to the buyer (A's refund_escrow)
--
-- Why a separate procedure when A's procedures already allow an admin to
-- release or refund? A's procedures also accept funded/completed escrows,
-- so on their own they can't guarantee a decision is only ever made on a
-- DISPUTED escrow. This procedure adds that rule and validates the
-- decision, then hands over to A's procedure, which moves the money,
-- locks the wallets and handles idempotency.
--
-- Retrying with the same key is safe: if the escrow already ended in the
-- state this decision produces, A's procedure replays the original
-- transaction (replayed = 1) instead of moving money again.
--
-- Errors use A's convention: SQLSTATE 45000, message "CODE: text".
-- Result: the same row A's procedure returns:  txn_id, replayed
-- =====================================================================

DELIMITER $$

DROP PROCEDURE IF EXISTS resolve_dispute$$
CREATE PROCEDURE resolve_dispute(
  IN p_escrow_id BIGINT UNSIGNED,
  IN p_decision  VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_key       VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  DECLARE v_actor  BIGINT UNSIGNED;
  DECLARE v_admin  TINYINT;
  DECLARE v_status VARCHAR(12) DEFAULT NULL;
  DECLARE v_target VARCHAR(12);

  -- Who is acting (fails if no @app_user_id, unknown user or frozen account).
  CALL _require_actor(v_actor, v_admin);
  IF NOT v_admin THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: only an admin can resolve a dispute';
  END IF;

  IF p_decision = 'release' THEN
    SET v_target = 'released';
  ELSEIF p_decision = 'refund' THEN
    SET v_target = 'refunded';
  ELSE
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: decision must be release or refund';
  END IF;

  -- Plain read, no lock: A's procedure re-reads the escrow with FOR UPDATE
  -- and re-checks the state inside its own transaction.
  SELECT status INTO v_status FROM escrows WHERE id = p_escrow_id;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: escrow does not exist';
  END IF;

  -- Allowed: the escrow is disputed, or it already ended in this decision's
  -- state (a retry, which A's procedure turns into a replay or a clear error).
  IF v_status <> 'disputed' AND v_status <> v_target THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: only a disputed escrow can be resolved';
  END IF;

  IF p_decision = 'release' THEN
    CALL release_escrow(p_escrow_id, p_key);
  ELSE
    CALL refund_escrow(p_escrow_id, p_key);
  END IF;
END$$

DELIMITER ;

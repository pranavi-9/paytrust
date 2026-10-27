-- =====================================================================
-- PayTrust: stored procedures (Member A)
--   mysql -u root -p paytrust < db/procedures.sql
--
-- Load order: schema.sql, schema_escrow.sql, THEN this file, then
-- triggers.sql and seed.sql. Re-running this file is safe.
--
-- RULES THESE PROCEDURES ENFORCE
--   1. Money only moves here. App code never UPDATEs wallets or INSERTs
--      ledger_entries itself.
--   2. Each movement = 1 transactions row + 1 debit + 1 credit, in one
--      database transaction (all or nothing).
--   3. Wallet rows are locked in ascending id order, so two requests can
--      never wait on each other in a circle (no deadlocks).
--   4. Idempotency: calling again with the same key returns the original
--      result (replayed = 1) and moves nothing. Re-using a key for a
--      different request is rejected.
--   5. The acting user comes from the session variable @app_user_id, which
--      the app sets with withActor(userId, fn) in lib/mysql.js. Member B's
--      audit trigger reads the same variable. No actor = no money moves.
--
-- ERRORS: every failure is SQLSTATE 45000 with a message that starts with a
-- code the API maps to an HTTP status:
--   INVALID_INPUT 400 | FORBIDDEN 403 | NOT_FOUND 404
--   INVALID_TRANSITION 409 | IDEMPOTENCY_CONFLICT 409 | INSUFFICIENT_BALANCE 422
--
-- RESULT: money procedures end with   SELECT txn_id, replayed;
--         complete/dispute end with   SELECT escrow_id, status, replayed;
--
-- Escrow state machine (who may do each step):
--   created   --fund_escrow-->     funded     buyer (or admin)
--   funded    --complete_escrow--> completed  seller (or admin)
--   completed --release_escrow-->  released   buyer (or admin)
--   funded|completed --dispute_escrow--> disputed   buyer, seller or admin
--   disputed  --release_escrow-->  released   admin only
--   funded|completed --refund_escrow--> refunded    seller (or admin)
--   disputed  --refund_escrow-->   refunded   admin only
-- =====================================================================

DELIMITER $$

-- ---------------------------------------------------------------------
-- _require_actor: who is acting? Fails if nobody, unknown or frozen.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _require_actor$$
CREATE PROCEDURE _require_actor(OUT o_actor BIGINT UNSIGNED, OUT o_is_admin TINYINT)
BEGIN
  DECLARE v_role VARCHAR(10) DEFAULT NULL;
  DECLARE v_active TINYINT DEFAULT NULL;

  IF @app_user_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: no acting user (set @app_user_id with withActor)';
  END IF;

  SELECT role, is_active INTO v_role, v_active FROM users WHERE id = @app_user_id;

  IF v_role IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: acting user does not exist';
  END IF;
  IF v_active = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: account is frozen';
  END IF;

  SET o_actor = @app_user_id;
  SET o_is_admin = (v_role = 'admin');
END$$

-- ---------------------------------------------------------------------
-- _apply_transfer: the ONE place where balances and the ledger change.
-- Internal. Must be called inside an open transaction. Locks both wallets
-- (lowest id first), replays on a known key, checks funds, then writes the
-- transaction, both balances and both ledger entries.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS _apply_transfer$$
CREATE PROCEDURE _apply_transfer(
  IN  p_type   VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN  p_from   BIGINT UNSIGNED,
  IN  p_to     BIGINT UNSIGNED,
  IN  p_amount DECIMAL(15,2),
  IN  p_key    VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN  p_actor  BIGINT UNSIGNED,
  IN  p_note   VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  OUT o_txn_id   BIGINT UNSIGNED,
  OUT o_replayed TINYINT
)
main: BEGIN
  DECLARE v_from_bal  DECIMAL(15,2) DEFAULT NULL;
  DECLARE v_to_bal    DECIMAL(15,2) DEFAULT NULL;
  DECLARE v_from_type VARCHAR(10)   DEFAULT NULL;
  DECLARE v_from_new  DECIMAL(15,2);
  DECLARE v_to_new    DECIMAL(15,2);
  DECLARE v_ex_id     BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_ex_type   VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci   DEFAULT NULL;
  DECLARE v_ex_from   BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_ex_to     BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_ex_amount DECIMAL(15,2) DEFAULT NULL;

  SET o_replayed = 0;

  -- Lock both wallets, always the lower id first.
  IF p_from < p_to THEN
    SELECT balance, wallet_type INTO v_from_bal, v_from_type FROM wallets WHERE id = p_from FOR UPDATE;
    SELECT balance INTO v_to_bal FROM wallets WHERE id = p_to FOR UPDATE;
  ELSE
    SELECT balance INTO v_to_bal FROM wallets WHERE id = p_to FOR UPDATE;
    SELECT balance, wallet_type INTO v_from_bal, v_from_type FROM wallets WHERE id = p_from FOR UPDATE;
  END IF;

  IF v_from_bal IS NULL OR v_to_bal IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: wallet does not exist';
  END IF;

  -- Idempotency: the wallets are locked, so a concurrent request with the
  -- same key has already committed (or is waiting behind us).
  SELECT id, type, from_wallet_id, to_wallet_id, amount
    INTO v_ex_id, v_ex_type, v_ex_from, v_ex_to, v_ex_amount
    FROM transactions WHERE idempotency_key = p_key;

  IF v_ex_id IS NOT NULL THEN
    IF v_ex_type = p_type AND v_ex_from = p_from AND v_ex_to = p_to AND v_ex_amount = p_amount THEN
      SET o_txn_id = v_ex_id;
      SET o_replayed = 1;
      LEAVE main;
    END IF;
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IDEMPOTENCY_CONFLICT: key was already used for a different request';
  END IF;

  -- Funds check (the top-up wallet is the money source, it may go negative).
  IF v_from_type <> 'topup' AND v_from_bal < p_amount THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INSUFFICIENT_BALANCE: not enough funds in the wallet';
  END IF;

  SET v_from_new = v_from_bal - p_amount;
  SET v_to_new   = v_to_bal + p_amount;

  INSERT INTO transactions (type, from_wallet_id, to_wallet_id, amount, idempotency_key, initiated_by, note)
  VALUES (p_type, p_from, p_to, p_amount, p_key, p_actor, p_note);
  SET o_txn_id = LAST_INSERT_ID();

  UPDATE wallets SET balance = v_from_new WHERE id = p_from;
  UPDATE wallets SET balance = v_to_new   WHERE id = p_to;

  INSERT INTO ledger_entries (transaction_id, wallet_id, entry_type, amount, balance_after) VALUES
    (o_txn_id, p_from, 'debit',  p_amount, v_from_new),
    (o_txn_id, p_to,   'credit', p_amount, v_to_new);
END$$

-- ---------------------------------------------------------------------
-- add_funds(user_id, amount, key): simulated top-up. topup wallet -> user.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS add_funds$$
CREATE PROCEDURE add_funds(
  IN p_user_id BIGINT UNSIGNED,
  IN p_amount  DECIMAL(15,2),
  IN p_key     VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  DECLARE v_actor BIGINT UNSIGNED;
  DECLARE v_admin TINYINT;
  DECLARE v_user_wallet  BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_topup_wallet BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_txn BIGINT UNSIGNED;
  DECLARE v_replayed TINYINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  CALL _require_actor(v_actor, v_admin);
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: amount must be greater than zero';
  END IF;
  IF p_key IS NULL OR CHAR_LENGTH(TRIM(p_key)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: idempotency key is required';
  END IF;
  IF NOT v_admin AND v_actor <> p_user_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: you can only add funds to your own wallet';
  END IF;

  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;

  SELECT id INTO v_user_wallet  FROM wallets WHERE user_id = p_user_id AND wallet_type = 'user';
  SELECT id INTO v_topup_wallet FROM wallets WHERE wallet_type = 'topup' LIMIT 1;
  IF v_user_wallet IS NULL OR v_topup_wallet IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: wallet does not exist';
  END IF;

  CALL _apply_transfer('topup', v_topup_wallet, v_user_wallet, p_amount, p_key, v_actor, 'Simulated top-up', v_txn, v_replayed);

  COMMIT;
  SELECT v_txn AS txn_id, v_replayed AS replayed;
END$$

-- ---------------------------------------------------------------------
-- process_transfer(from_wallet, to_wallet, amount, key): user to user.
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS process_transfer$$
CREATE PROCEDURE process_transfer(
  IN p_from_wallet BIGINT UNSIGNED,
  IN p_to_wallet   BIGINT UNSIGNED,
  IN p_amount      DECIMAL(15,2),
  IN p_key         VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  DECLARE v_actor BIGINT UNSIGNED;
  DECLARE v_admin TINYINT;
  DECLARE v_from_owner  BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_from_type   VARCHAR(10) DEFAULT NULL;
  DECLARE v_from_active TINYINT DEFAULT NULL;
  DECLARE v_to_type     VARCHAR(10) DEFAULT NULL;
  DECLARE v_to_active   TINYINT DEFAULT NULL;
  DECLARE v_txn BIGINT UNSIGNED;
  DECLARE v_replayed TINYINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  CALL _require_actor(v_actor, v_admin);
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: amount must be greater than zero';
  END IF;
  IF p_key IS NULL OR CHAR_LENGTH(TRIM(p_key)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: idempotency key is required';
  END IF;
  IF p_from_wallet = p_to_wallet THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: cannot transfer to the same wallet';
  END IF;

  SELECT w.user_id, w.wallet_type, u.is_active INTO v_from_owner, v_from_type, v_from_active
    FROM wallets w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = p_from_wallet;
  SELECT w.wallet_type, u.is_active INTO v_to_type, v_to_active
    FROM wallets w LEFT JOIN users u ON u.id = w.user_id WHERE w.id = p_to_wallet;

  IF v_from_type IS NULL OR v_to_type IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: wallet does not exist';
  END IF;
  IF v_from_type <> 'user' OR v_to_type <> 'user' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: transfers are only between user wallets';
  END IF;
  IF NOT v_admin AND v_from_owner <> v_actor THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: you can only send money from your own wallet';
  END IF;
  IF v_from_active = 0 OR v_to_active = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: a wallet in this transfer belongs to a frozen account';
  END IF;

  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;
  CALL _apply_transfer('transfer', p_from_wallet, p_to_wallet, p_amount, p_key, v_actor, NULL, v_txn, v_replayed);
  COMMIT;
  SELECT v_txn AS txn_id, v_replayed AS replayed;
END$$

-- ---------------------------------------------------------------------
-- fund_escrow(escrow_id, key): buyer wallet -> escrow wallet.
-- created -> funded
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS fund_escrow$$
CREATE PROCEDURE fund_escrow(IN p_escrow_id BIGINT UNSIGNED, IN p_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci)
BEGIN
  DECLARE v_actor BIGINT UNSIGNED;
  DECLARE v_admin TINYINT;
  DECLARE v_buyer BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_amount DECIMAL(15,2);
  DECLARE v_status VARCHAR(12) DEFAULT NULL;
  DECLARE v_fund_txn BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_buyer_wallet  BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_escrow_wallet BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_txn BIGINT UNSIGNED;
  DECLARE v_replayed TINYINT DEFAULT 0;
  DECLARE v_prev_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  CALL _require_actor(v_actor, v_admin);
  IF p_key IS NULL OR CHAR_LENGTH(TRIM(p_key)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: idempotency key is required';
  END IF;

  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;

  SELECT buyer_id, amount, status, fund_txn_id INTO v_buyer, v_amount, v_status, v_fund_txn
    FROM escrows WHERE id = p_escrow_id FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: escrow does not exist';
  END IF;
  IF NOT v_admin AND v_actor <> v_buyer THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: only the buyer can fund this escrow';
  END IF;

  IF v_status = 'created' THEN
    SELECT id INTO v_buyer_wallet  FROM wallets WHERE user_id = v_buyer AND wallet_type = 'user';
    SELECT id INTO v_escrow_wallet FROM wallets WHERE wallet_type = 'escrow' LIMIT 1;
    IF v_buyer_wallet IS NULL OR v_escrow_wallet IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: wallet does not exist';
    END IF;

    CALL _apply_transfer('escrow_fund', v_buyer_wallet, v_escrow_wallet, v_amount, p_key, v_actor, NULL, v_txn, v_replayed);

    -- status and fund_txn_id change in the same UPDATE (Member B's CHECK needs both)
    UPDATE escrows SET status = 'funded', fund_txn_id = v_txn, funded_at = NOW(3) WHERE id = p_escrow_id;
  ELSE
    -- Already funded earlier. If this is the same request being repeated, replay it.
    IF v_fund_txn IS NOT NULL THEN
      SELECT idempotency_key INTO v_prev_key FROM transactions WHERE id = v_fund_txn;
    END IF;
    IF v_prev_key = p_key THEN
      SET v_txn = v_fund_txn;
      SET v_replayed = 1;
    ELSE
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: escrow can only be funded from the created state';
    END IF;
  END IF;

  COMMIT;
  SELECT v_txn AS txn_id, v_replayed AS replayed;
END$$

-- ---------------------------------------------------------------------
-- complete_escrow(escrow_id): seller says the work is done. No money moves.
-- funded -> completed. Repeating it is harmless (replayed = 1).
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS complete_escrow$$
CREATE PROCEDURE complete_escrow(IN p_escrow_id BIGINT UNSIGNED)
BEGIN
  DECLARE v_actor BIGINT UNSIGNED;
  DECLARE v_admin TINYINT;
  DECLARE v_seller BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_status VARCHAR(12) DEFAULT NULL;
  DECLARE v_replayed TINYINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  CALL _require_actor(v_actor, v_admin);

  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;

  SELECT seller_id, status INTO v_seller, v_status FROM escrows WHERE id = p_escrow_id FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: escrow does not exist';
  END IF;
  IF NOT v_admin AND v_actor <> v_seller THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: only the seller can mark this escrow complete';
  END IF;

  IF v_status = 'funded' THEN
    UPDATE escrows SET status = 'completed', completed_at = NOW(3) WHERE id = p_escrow_id;
    SET v_status = 'completed';
  ELSEIF v_status = 'completed' THEN
    SET v_replayed = 1;
  ELSE
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: escrow must be funded before it can be completed';
  END IF;

  COMMIT;
  SELECT p_escrow_id AS escrow_id, v_status AS status, v_replayed AS replayed;
END$$

-- ---------------------------------------------------------------------
-- dispute_escrow(escrow_id): freeze the escrow until an admin decides.
-- No money moves. funded|completed -> disputed. Repeat is harmless.
-- (Member B's dispute API can call this, then store the case in MongoDB.)
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS dispute_escrow$$
CREATE PROCEDURE dispute_escrow(IN p_escrow_id BIGINT UNSIGNED)
BEGIN
  DECLARE v_actor BIGINT UNSIGNED;
  DECLARE v_admin TINYINT;
  DECLARE v_buyer  BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_seller BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_status VARCHAR(12) DEFAULT NULL;
  DECLARE v_replayed TINYINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  CALL _require_actor(v_actor, v_admin);

  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;

  SELECT buyer_id, seller_id, status INTO v_buyer, v_seller, v_status
    FROM escrows WHERE id = p_escrow_id FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: escrow does not exist';
  END IF;
  IF NOT v_admin AND v_actor <> v_buyer AND v_actor <> v_seller THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: only the buyer or seller can dispute this escrow';
  END IF;

  IF v_status IN ('funded', 'completed') THEN
    UPDATE escrows SET status = 'disputed' WHERE id = p_escrow_id;
    SET v_status = 'disputed';
  ELSEIF v_status = 'disputed' THEN
    SET v_replayed = 1;
  ELSE
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: only a funded or completed escrow can be disputed';
  END IF;

  COMMIT;
  SELECT p_escrow_id AS escrow_id, v_status AS status, v_replayed AS replayed;
END$$

-- ---------------------------------------------------------------------
-- release_escrow(escrow_id, key): escrow wallet -> seller wallet.
-- completed -> released (buyer or admin); disputed -> released (admin only)
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS release_escrow$$
CREATE PROCEDURE release_escrow(IN p_escrow_id BIGINT UNSIGNED, IN p_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci)
BEGIN
  DECLARE v_actor BIGINT UNSIGNED;
  DECLARE v_admin TINYINT;
  DECLARE v_buyer  BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_seller BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_amount DECIMAL(15,2);
  DECLARE v_status VARCHAR(12) DEFAULT NULL;
  DECLARE v_settle_txn BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_seller_wallet BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_escrow_wallet BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_txn BIGINT UNSIGNED;
  DECLARE v_replayed TINYINT DEFAULT 0;
  DECLARE v_prev_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  CALL _require_actor(v_actor, v_admin);
  IF p_key IS NULL OR CHAR_LENGTH(TRIM(p_key)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: idempotency key is required';
  END IF;

  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;

  SELECT buyer_id, seller_id, amount, status, settle_txn_id
    INTO v_buyer, v_seller, v_amount, v_status, v_settle_txn
    FROM escrows WHERE id = p_escrow_id FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: escrow does not exist';
  END IF;

  IF v_status = 'completed' THEN
    IF NOT v_admin AND v_actor <> v_buyer THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: only the buyer can release this escrow';
    END IF;
  ELSEIF v_status = 'disputed' THEN
    IF NOT v_admin THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: only an admin can resolve a disputed escrow';
    END IF;
  END IF;

  IF v_status IN ('completed', 'disputed') THEN
    SELECT id INTO v_seller_wallet FROM wallets WHERE user_id = v_seller AND wallet_type = 'user';
    SELECT id INTO v_escrow_wallet FROM wallets WHERE wallet_type = 'escrow' LIMIT 1;
    IF v_seller_wallet IS NULL OR v_escrow_wallet IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: wallet does not exist';
    END IF;

    CALL _apply_transfer('escrow_release', v_escrow_wallet, v_seller_wallet, v_amount, p_key, v_actor, NULL, v_txn, v_replayed);

    UPDATE escrows SET status = 'released', settle_txn_id = v_txn, settled_at = NOW(3) WHERE id = p_escrow_id;
  ELSE
    -- Already released earlier? Same key = the same request repeated.
    IF v_status = 'released' AND v_settle_txn IS NOT NULL THEN
      SELECT idempotency_key INTO v_prev_key FROM transactions WHERE id = v_settle_txn;
    END IF;
    IF v_prev_key = p_key THEN
      SET v_txn = v_settle_txn;
      SET v_replayed = 1;
    ELSE
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: escrow can only be released from completed or disputed';
    END IF;
  END IF;

  COMMIT;
  SELECT v_txn AS txn_id, v_replayed AS replayed;
END$$

-- ---------------------------------------------------------------------
-- refund_escrow(escrow_id, key): escrow wallet -> buyer wallet.
-- funded|completed -> refunded (seller or admin); disputed -> refunded (admin only)
-- ---------------------------------------------------------------------
DROP PROCEDURE IF EXISTS refund_escrow$$
CREATE PROCEDURE refund_escrow(IN p_escrow_id BIGINT UNSIGNED, IN p_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci)
BEGIN
  DECLARE v_actor BIGINT UNSIGNED;
  DECLARE v_admin TINYINT;
  DECLARE v_buyer  BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_seller BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_amount DECIMAL(15,2);
  DECLARE v_status VARCHAR(12) DEFAULT NULL;
  DECLARE v_settle_txn BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_buyer_wallet  BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_escrow_wallet BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_txn BIGINT UNSIGNED;
  DECLARE v_replayed TINYINT DEFAULT 0;
  DECLARE v_prev_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  CALL _require_actor(v_actor, v_admin);
  IF p_key IS NULL OR CHAR_LENGTH(TRIM(p_key)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: idempotency key is required';
  END IF;

  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;

  SELECT buyer_id, seller_id, amount, status, settle_txn_id
    INTO v_buyer, v_seller, v_amount, v_status, v_settle_txn
    FROM escrows WHERE id = p_escrow_id FOR UPDATE;

  IF v_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: escrow does not exist';
  END IF;

  IF v_status IN ('funded', 'completed') THEN
    IF NOT v_admin AND v_actor <> v_seller THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: only the seller can refund this escrow';
    END IF;
  ELSEIF v_status = 'disputed' THEN
    IF NOT v_admin THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: only an admin can resolve a disputed escrow';
    END IF;
  END IF;

  IF v_status IN ('funded', 'completed', 'disputed') THEN
    SELECT id INTO v_buyer_wallet  FROM wallets WHERE user_id = v_buyer AND wallet_type = 'user';
    SELECT id INTO v_escrow_wallet FROM wallets WHERE wallet_type = 'escrow' LIMIT 1;
    IF v_buyer_wallet IS NULL OR v_escrow_wallet IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'NOT_FOUND: wallet does not exist';
    END IF;

    CALL _apply_transfer('escrow_refund', v_escrow_wallet, v_buyer_wallet, v_amount, p_key, v_actor, NULL, v_txn, v_replayed);

    UPDATE escrows SET status = 'refunded', settle_txn_id = v_txn, settled_at = NOW(3) WHERE id = p_escrow_id;
  ELSE
    IF v_status = 'refunded' AND v_settle_txn IS NOT NULL THEN
      SELECT idempotency_key INTO v_prev_key FROM transactions WHERE id = v_settle_txn;
    END IF;
    IF v_prev_key = p_key THEN
      SET v_txn = v_settle_txn;
      SET v_replayed = 1;
    ELSE
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_TRANSITION: escrow can only be refunded from funded, completed or disputed';
    END IF;
  END IF;

  COMMIT;
  SELECT v_txn AS txn_id, v_replayed AS replayed;
END$$

-- ---------------------------------------------------------------------
-- Append-only guards: money history can be added to, never edited or
-- erased. A mistake is fixed with a new, opposite transaction.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_ledger_no_update$$
CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON ledger_entries
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LEDGER_IMMUTABLE: ledger_entries is append-only'$$

DROP TRIGGER IF EXISTS trg_ledger_no_delete$$
CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON ledger_entries
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LEDGER_IMMUTABLE: ledger_entries is append-only'$$

DROP TRIGGER IF EXISTS trg_txn_no_update$$
CREATE TRIGGER trg_txn_no_update BEFORE UPDATE ON transactions
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LEDGER_IMMUTABLE: transactions is append-only'$$

DROP TRIGGER IF EXISTS trg_txn_no_delete$$
CREATE TRIGGER trg_txn_no_delete BEFORE DELETE ON transactions
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'LEDGER_IMMUTABLE: transactions is append-only'$$

DELIMITER ;

-- =====================================================================
-- create_escrow: a buyer opens a new escrow with a seller (no money moves;
-- the buyer funds it later with fund_escrow).
--   CALL create_escrow(seller_email, amount, title, description, idempotency_key)
--   RESULT: SELECT escrow_id, replayed;
-- Idempotent per buyer: the same key + same details returns the original
-- escrow (replayed = 1); same key with different details is rejected.
-- Errors: INVALID_INPUT (bad amount/title, unknown seller, seller = buyer),
--         FORBIDDEN (no actor, frozen account, admin), IDEMPOTENCY_CONFLICT
-- =====================================================================
CREATE TABLE IF NOT EXISTS escrow_create_requests (
  buyer_id        BIGINT UNSIGNED NOT NULL,
  idempotency_key VARCHAR(64)     NOT NULL,
  seller_id       BIGINT UNSIGNED NOT NULL,
  amount          DECIMAL(15,2)   NOT NULL,
  title           VARCHAR(120)    NOT NULL,
  escrow_id       BIGINT UNSIGNED NOT NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (buyer_id, idempotency_key),
  UNIQUE KEY uq_create_req_escrow (escrow_id),
  CONSTRAINT fk_create_req_buyer  FOREIGN KEY (buyer_id)  REFERENCES users(id),
  CONSTRAINT fk_create_req_seller FOREIGN KEY (seller_id) REFERENCES users(id),
  CONSTRAINT fk_create_req_escrow FOREIGN KEY (escrow_id) REFERENCES escrows(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

DROP PROCEDURE IF EXISTS create_escrow$$
CREATE PROCEDURE create_escrow(
  IN p_seller_email VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_amount       DECIMAL(15,2),
  IN p_title        VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_description  VARCHAR(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  IN p_key          VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
)
BEGIN
  DECLARE v_actor BIGINT UNSIGNED;
  DECLARE v_admin TINYINT;
  DECLARE v_seller BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_seller_active TINYINT DEFAULT NULL;
  DECLARE v_title VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  DECLARE v_desc  VARCHAR(2000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  DECLARE v_escrow BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_ex_escrow BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_ex_seller BIGINT UNSIGNED DEFAULT NULL;
  DECLARE v_ex_amount DECIMAL(15,2) DEFAULT NULL;
  DECLARE v_ex_title  VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL;
  DECLARE v_replayed TINYINT DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

  CALL _require_actor(v_actor, v_admin);
  IF v_admin THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FORBIDDEN: admins cannot create escrows';
  END IF;
  IF p_key IS NULL OR CHAR_LENGTH(TRIM(p_key)) = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: idempotency key is required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: amount must be greater than zero';
  END IF;
  SET v_title = TRIM(p_title);
  IF v_title IS NULL OR CHAR_LENGTH(v_title) < 3 OR CHAR_LENGTH(v_title) > 120 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: title must be 3 to 120 characters';
  END IF;
  SET v_desc = NULLIF(TRIM(p_description), '');
  IF v_desc IS NOT NULL AND CHAR_LENGTH(v_desc) > 1000 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: details must be at most 1000 characters';
  END IF;

  SELECT id, is_active INTO v_seller, v_seller_active
    FROM users WHERE email = LOWER(TRIM(p_seller_email)) AND role = 'user';
  IF v_seller IS NULL OR v_seller_active = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: no PayTrust user with that email';
  END IF;
  IF v_seller = v_actor THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'INVALID_INPUT: you cannot create an escrow with yourself';
  END IF;

  SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
  START TRANSACTION;

  -- Serialise this buyer's requests so two identical retries cannot both insert.
  SELECT id INTO v_actor FROM users WHERE id = v_actor FOR UPDATE;

  SELECT escrow_id, seller_id, amount, title INTO v_ex_escrow, v_ex_seller, v_ex_amount, v_ex_title
    FROM escrow_create_requests WHERE buyer_id = v_actor AND idempotency_key = p_key FOR UPDATE;

  IF v_ex_escrow IS NOT NULL THEN
    IF v_ex_seller = v_seller AND v_ex_amount = p_amount AND v_ex_title = v_title THEN
      SET v_escrow = v_ex_escrow;
      SET v_replayed = 1;
    ELSE
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'IDEMPOTENCY_CONFLICT: key was already used for a different escrow';
    END IF;
  ELSE
    INSERT INTO escrows (buyer_id, seller_id, amount, title, description)
    VALUES (v_actor, v_seller, p_amount, v_title, v_desc);
    SET v_escrow = LAST_INSERT_ID();
    INSERT INTO escrow_create_requests (buyer_id, idempotency_key, seller_id, amount, title, escrow_id)
    VALUES (v_actor, p_key, v_seller, p_amount, v_title, v_escrow);
  END IF;

  COMMIT;
  SELECT v_escrow AS escrow_id, v_replayed AS replayed;
END$$

DELIMITER ;

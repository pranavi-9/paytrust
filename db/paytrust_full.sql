-- =====================================================================
-- PayTrust: complete MySQL database in ONE file (schema + procedures + triggers + data)
--
--   mysql -u root -p < paytrust_full.sql
--
-- Creates the database `paytrust` (DROPS it first if it exists) and loads, in order:
--   schema.sql, schema_escrow.sql, procedures.sql, disputes.sql, triggers.sql,
--   seed.sql, seed_part2.sql, seed_bulk.sql
-- Result: 26 users, 27 wallets, 119 transactions, 238 ledger entries, 34 escrows
-- (created, funded, completed, released, refunded, disputed), audit rows, and a ledger
-- that reconciles to zero. Demo login for every user: <name>@paytrust.test / Demo@1234
-- =====================================================================
DROP DATABASE IF EXISTS paytrust;
CREATE DATABASE paytrust CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE paytrust;

-- ===================== db/schema.sql =====================
-- =====================================================================
-- PayTrust: ledger schema (Member A)
--   mysql -u root -p paytrust < db/schema.sql
--
-- Load this FIRST. Member B's db/schema_escrow.sql references users and
-- transactions, so it must run after this file.
--
-- Money model
--   * wallets.balance is a cached number. The truth is ledger_entries:
--       balance = SUM(credits) - SUM(debits)   (see wallet_balance_summary)
--   * Every money movement is ONE row in transactions plus EXACTLY TWO rows
--     in ledger_entries (one debit, one credit). Nothing else may change a
--     balance: only the stored procedures in db/procedures.sql do.
--   * System wallets: 'topup' is the source of "add funds" (its balance goes
--     negative by design), 'escrow' holds money while an escrow is funded.
--     Because of that, SUM(balance) over ALL wallets is always exactly 0.
--
-- Column names match what Member B's files expect:
--   users(id, full_name, email, password_hash, role), BIGINT UNSIGNED ids,
--   wallets with defaults for everything except user_id.
-- =====================================================================

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  full_name     VARCHAR(100)    NOT NULL,
  email         VARCHAR(150)    NOT NULL,
  password_hash VARCHAR(255)    NOT NULL,
  role          ENUM('user','admin') NOT NULL DEFAULT 'user',
  kyc_status    ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  is_active     BOOLEAN         NOT NULL DEFAULT TRUE,   -- admin can freeze an account
  created_at    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  CONSTRAINT chk_users_email_shape CHECK (email LIKE '_%@_%._%'),
  CONSTRAINT chk_users_name_not_blank CHECK (CHAR_LENGTH(TRIM(full_name)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- wallets: one per normal user, plus the two system wallets
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wallets (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id     BIGINT UNSIGNED NULL,                      -- NULL for system wallets
  wallet_type ENUM('user','escrow','topup') NOT NULL DEFAULT 'user',
  balance     DECIMAL(15,2)   NOT NULL DEFAULT 0.00,
  created_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                              ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_wallet_user (user_id),                   -- at most one wallet per user
  CONSTRAINT fk_wallet_user FOREIGN KEY (user_id) REFERENCES users(id),
  -- Nobody can go below zero, except the top-up source wallet.
  CONSTRAINT chk_wallet_balance_nonneg CHECK (balance >= 0 OR wallet_type = 'topup'),
  -- User wallets belong to a user; system wallets belong to nobody.
  CONSTRAINT chk_wallet_owner CHECK (
    (wallet_type = 'user' AND user_id IS NOT NULL) OR
    (wallet_type <> 'user' AND user_id IS NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- transactions: one row per money movement (always completed; a failed
-- movement is rolled back and leaves no row)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type            ENUM('topup','transfer','escrow_fund','escrow_release','escrow_refund') NOT NULL,
  from_wallet_id  BIGINT UNSIGNED NOT NULL,
  to_wallet_id    BIGINT UNSIGNED NOT NULL,
  amount          DECIMAL(15,2)   NOT NULL,
  idempotency_key VARCHAR(64)     NOT NULL,              -- same key = same result, never twice
  initiated_by    BIGINT UNSIGNED NULL,                  -- users.id from @app_user_id
  note            VARCHAR(255)    NULL,
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  UNIQUE KEY uq_txn_idempotency (idempotency_key),
  CONSTRAINT fk_txn_from FOREIGN KEY (from_wallet_id) REFERENCES wallets(id),
  CONSTRAINT fk_txn_to   FOREIGN KEY (to_wallet_id)   REFERENCES wallets(id),
  CONSTRAINT fk_txn_by   FOREIGN KEY (initiated_by)   REFERENCES users(id),
  CONSTRAINT chk_txn_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_txn_wallets_differ  CHECK (from_wallet_id <> to_wallet_id),
  KEY idx_txn_from_time (from_wallet_id, created_at),
  KEY idx_txn_to_time   (to_wallet_id, created_at),
  KEY idx_txn_type_time (type, created_at)
  -- NOTE: no escrow_id here on purpose. escrows.fund_txn_id / settle_txn_id
  -- (Member B's table) point at transactions, so the link lives on that side.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ledger_entries: the double-entry book. Append-only (see triggers at the
-- end of procedures.sql).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger_entries (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  transaction_id BIGINT UNSIGNED NOT NULL,
  wallet_id      BIGINT UNSIGNED NOT NULL,
  entry_type     ENUM('debit','credit') NOT NULL,
  amount         DECIMAL(15,2)   NOT NULL,
  balance_after  DECIMAL(15,2)   NOT NULL,               -- wallet balance right after this entry
  created_at     DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  -- Exactly one debit and one credit per transaction: double entry, enforced by the database.
  UNIQUE KEY uq_ledger_txn_side (transaction_id, entry_type),
  CONSTRAINT fk_ledger_txn    FOREIGN KEY (transaction_id) REFERENCES transactions(id),
  CONSTRAINT fk_ledger_wallet FOREIGN KEY (wallet_id)      REFERENCES wallets(id),
  CONSTRAINT chk_ledger_amount_positive CHECK (amount > 0),
  -- Wallet statement: entries of one wallet in order.
  KEY idx_ledger_wallet_time (wallet_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- System wallets (inserted once; safe to re-run)
-- ---------------------------------------------------------------------
INSERT INTO wallets (user_id, wallet_type)
SELECT NULL, 'topup'
WHERE NOT EXISTS (SELECT 1 FROM wallets WHERE wallet_type = 'topup');

INSERT INTO wallets (user_id, wallet_type)
SELECT NULL, 'escrow'
WHERE NOT EXISTS (SELECT 1 FROM wallets WHERE wallet_type = 'escrow');

-- ---------------------------------------------------------------------
-- View used by the reconciliation page: cached balance vs. the balance
-- re-computed from the ledger. A healthy system has difference = 0 on
-- every row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW wallet_balance_summary AS
SELECT
  w.id          AS wallet_id,
  w.user_id     AS user_id,
  w.wallet_type AS wallet_type,
  w.balance     AS cached_balance,
  COALESCE(SUM(CASE le.entry_type WHEN 'credit' THEN le.amount
                                  WHEN 'debit'  THEN -le.amount END), 0) AS ledger_derived_balance,
  w.balance - COALESCE(SUM(CASE le.entry_type WHEN 'credit' THEN le.amount
                                              WHEN 'debit'  THEN -le.amount END), 0) AS difference
FROM wallets w
LEFT JOIN ledger_entries le ON le.wallet_id = w.id
GROUP BY w.id, w.user_id, w.wallet_type, w.balance;

-- ===================== db/schema_escrow.sql =====================
-- =====================================================================
-- PayTrust: escrow tables (Member B)
-- Run AFTER Member A's ledger schema (users, wallets, transactions,
-- ledger_entries), because escrows reference users and transactions.
--
-- Assumes A's tables use:  users.id, transactions.id  as BIGINT UNSIGNED.
-- If A picks a different id type, change the matching columns below.
-- =====================================================================

-- ---------------------------------------------------------------------
-- escrows: one row per buyer/seller deal. Money never sits in this
-- table; while funded, it sits in the escrow holding wallet (A's).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escrows (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  buyer_id        BIGINT UNSIGNED NOT NULL,
  seller_id       BIGINT UNSIGNED NOT NULL,
  amount          DECIMAL(15,2)   NOT NULL,
  title           VARCHAR(120)    NOT NULL,
  description     VARCHAR(1000)   NULL,
  status          ENUM('created','funded','completed','released','refunded','disputed')
                                  NOT NULL DEFAULT 'created',
  -- Ledger links, filled in by A's procedures when money moves.
  fund_txn_id     BIGINT UNSIGNED NULL,
  settle_txn_id   BIGINT UNSIGNED NULL,   -- the release OR refund transaction
  created_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  funded_at       DATETIME(3)     NULL,
  completed_at    DATETIME(3)     NULL,
  settled_at      DATETIME(3)     NULL,
  updated_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
                                  ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  CONSTRAINT fk_escrow_buyer   FOREIGN KEY (buyer_id)      REFERENCES users(id),
  CONSTRAINT fk_escrow_seller  FOREIGN KEY (seller_id)     REFERENCES users(id),
  CONSTRAINT fk_escrow_fund_tx FOREIGN KEY (fund_txn_id)   REFERENCES transactions(id),
  CONSTRAINT fk_escrow_settle_tx FOREIGN KEY (settle_txn_id) REFERENCES transactions(id),

  CONSTRAINT chk_escrow_amount_positive CHECK (amount > 0),
  CONSTRAINT chk_escrow_parties_differ  CHECK (buyer_id <> seller_id),
  -- Once money has moved in, there must be a funding transaction.
  CONSTRAINT chk_escrow_funded_has_txn  CHECK (status = 'created' OR fund_txn_id IS NOT NULL),
  -- Released/refunded escrows must point at the settling transaction.
  CONSTRAINT chk_escrow_settled_has_txn CHECK (status NOT IN ('released','refunded') OR settle_txn_id IS NOT NULL),

  UNIQUE KEY uq_escrow_fund_txn   (fund_txn_id),
  UNIQUE KEY uq_escrow_settle_txn (settle_txn_id),
  -- "My escrows" lists, filtered by status (buyer side and seller side).
  KEY idx_escrow_buyer_status  (buyer_id,  status, created_at),
  KEY idx_escrow_seller_status (seller_id, status, created_at),
  -- Admin views: all disputed / all funded, newest first.
  KEY idx_escrow_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- escrow_status_audit: append-only history, written ONLY by the
-- triggers in triggers.sql. The app never inserts here directly.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS escrow_status_audit (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  escrow_id   BIGINT UNSIGNED NOT NULL,
  old_status  ENUM('created','funded','completed','released','refunded','disputed') NULL,  -- NULL on creation
  new_status  ENUM('created','funded','completed','released','refunded','disputed') NOT NULL,
  changed_by  BIGINT UNSIGNED NULL,  -- from @app_user_id; NULL if changed outside the app
  db_user     VARCHAR(100)    NOT NULL,  -- MySQL account that ran the change
  changed_at  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  CONSTRAINT fk_audit_escrow FOREIGN KEY (escrow_id)  REFERENCES escrows(id),
  CONSTRAINT fk_audit_user   FOREIGN KEY (changed_by) REFERENCES users(id),
  CONSTRAINT chk_audit_status_changed CHECK (old_status IS NULL OR old_status <> new_status),

  -- Escrow detail page: full history of one escrow in order.
  KEY idx_audit_escrow_time (escrow_id, changed_at),
  KEY idx_audit_changed_by  (changed_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ===================== db/procedures.sql =====================
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

-- ===================== db/disputes.sql =====================
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

-- ===================== db/triggers.sql =====================
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

-- ===================== db/seed.sql =====================
-- =====================================================================
-- PayTrust: seed data (Member B)
-- Run after both schemas and triggers.sql:
--   mysql -u root -p paytrust < db/seed.sql
--
-- Every seeded user's password is:  Demo@1234   (bcrypt hash below)
--
-- This part moves NO money. It creates users, empty wallets and escrows
-- in 'created' status only. Balances and funded/released escrows come
-- from A's procedures in db/seed_part2.sql, so the ledger reconciles.
--
-- Assumed columns in A's tables (adjust if A's schema differs):
--   users  (id, full_name, email, password_hash, role)
--   wallets(user_id)  with balance defaulting to 0.00
-- =====================================================================

START TRANSACTION;

SET @app_user_id = NULL;
SET @pw = '$2b$10$ADVzfSg9ulxwhZikOB4OEu67CSTCFYDBEWr6Bw.FMEx4rFUU9Ub8y';

INSERT INTO users (id, full_name, email, password_hash, role) VALUES
  (101, 'Admin User',    'admin@paytrust.test',  @pw, 'admin'),
  (102, 'Aarav Sharma',  'aarav@paytrust.test',  @pw, 'user'),
  (103, 'Diya Patel',    'diya@paytrust.test',   @pw, 'user'),
  (104, 'Kabir Rao',     'kabir@paytrust.test',  @pw, 'user'),
  (105, 'Meera Iyer',    'meera@paytrust.test',  @pw, 'user'),
  (106, 'Rohan Gupta',   'rohan@paytrust.test',  @pw, 'user');

-- One wallet per normal user (the admin does not trade).
INSERT INTO wallets (user_id)
SELECT id FROM users WHERE id BETWEEN 102 AND 106;

-- Escrows waiting to be funded. The insert trigger logs each one.
INSERT INTO escrows (buyer_id, seller_id, amount, title, description) VALUES
  (102, 103, 2500.00, 'Logo design',          'Three logo concepts and final files'),
  (102, 104, 12000.00,'Used laptop',          'ThinkPad T14, shipped by courier'),
  (103, 105, 800.00,  'Calculus tutoring',    'Four one-hour sessions'),
  (104, 106, 4500.00, 'Event photography',    'College fest, 200 edited photos'),
  (105, 102, 1500.00, 'Website bug fixes',    'Fix contact form and mobile layout'),
  (106, 103, 650.00,  'Handmade notebook set','Set of three, delivered on campus');

COMMIT;

-- =====================================================================
-- PART 2: demo money lives in Member A's db/seed_part2.sql. Run it next:
--   mysql -u root -p paytrust < db/seed_part2.sql
-- It tops up wallets through add_funds and moves escrows 1-3 through
-- fund / complete / release / dispute, so every status has an example and
-- the ledger reconciles to zero.
-- =====================================================================

-- ===================== db/seed_part2.sql =====================
-- Member A: demo money for seed PART 2 (replaces the commented block in seed.sql).
-- Run AFTER seed.sql. Wallets: 3=Aarav(102) 4=Diya(103) 5=Kabir(104) 6=Meera(105) 7=Rohan(106)
SET @app_user_id = 102; CALL add_funds(102, 50000.00, 'seed-topup-102');
SET @app_user_id = 103; CALL add_funds(103, 20000.00, 'seed-topup-103');
SET @app_user_id = 105; CALL add_funds(105, 10000.00, 'seed-topup-105');
SET @app_user_id = 102; CALL process_transfer(3, 4, 500.00, 'seed-transfer-1');
SET @app_user_id = 103; CALL process_transfer(4, 6, 250.00, 'seed-transfer-2');
-- escrow 1 (Aarav -> Diya): full happy path
SET @app_user_id = 102; CALL fund_escrow(1, 'seed-fund-1');
SET @app_user_id = 103; CALL complete_escrow(1);
SET @app_user_id = 102; CALL release_escrow(1, 'seed-release-1');
-- escrow 2 (Aarav -> Kabir): funded, waiting on seller
SET @app_user_id = 102; CALL fund_escrow(2, 'seed-fund-2');
-- escrow 3 (Diya -> Meera): disputed, for the admin to resolve
SET @app_user_id = 103; CALL fund_escrow(3, 'seed-fund-3');
SET @app_user_id = 105; CALL dispute_escrow(3);
SET @app_user_id = NULL;

-- ===================== db/seed_bulk.sql =====================
-- =====================================================================
-- PayTrust: bulk demo data (Member A)
--   mysql -u root -p paytrust < db/seed_bulk.sql
-- Run AFTER seed.sql and seed_part2.sql. Adds 20 users and ~100 money movements
-- (top-ups, transfers, escrows in every state). Every rupee goes through the stored
-- procedures, so the ledger still balances: wallet_balance_summary shows difference 0.
-- All new users have the password  Demo@1234  (same hash as seed.sql).
-- =====================================================================

SET @pw = '$2b$10$ADVzfSg9ulxwhZikOB4OEu67CSTCFYDBEWr6Bw.FMEx4rFUU9Ub8y';
SET @app_user_id = NULL;

UPDATE users SET kyc_status = 'verified' WHERE id IN (102, 103, 104);
UPDATE users SET kyc_status = 'rejected' WHERE id = 106;

INSERT INTO users (id, full_name, email, password_hash, role, kyc_status) VALUES
  (201, 'Ananya Nair', 'ananya@paytrust.test', @pw, 'user', 'verified'),
  (202, 'Vikram Singh', 'vikram@paytrust.test', @pw, 'user', 'verified'),
  (203, 'Ishita Menon', 'ishita@paytrust.test', @pw, 'user', 'verified'),
  (204, 'Arjun Reddy', 'arjun@paytrust.test', @pw, 'user', 'pending'),
  (205, 'Sneha Kulkarni', 'sneha@paytrust.test', @pw, 'user', 'verified'),
  (206, 'Rahul Verma', 'rahul@paytrust.test', @pw, 'user', 'verified'),
  (207, 'Pooja Bhat', 'pooja@paytrust.test', @pw, 'user', 'verified'),
  (208, 'Nikhil Joshi', 'nikhil@paytrust.test', @pw, 'user', 'rejected'),
  (209, 'Tanvi Desai', 'tanvi@paytrust.test', @pw, 'user', 'verified'),
  (210, 'Aditya Kapoor', 'aditya@paytrust.test', @pw, 'user', 'verified'),
  (211, 'Kavya Pillai', 'kavya@paytrust.test', @pw, 'user', 'verified'),
  (212, 'Siddharth Das', 'siddharth@paytrust.test', @pw, 'user', 'pending'),
  (213, 'Riya Malhotra', 'riya@paytrust.test', @pw, 'user', 'verified'),
  (214, 'Harsh Agarwal', 'harsh@paytrust.test', @pw, 'user', 'verified'),
  (215, 'Neha Chopra', 'neha@paytrust.test', @pw, 'user', 'verified'),
  (216, 'Manav Shah', 'manav@paytrust.test', @pw, 'user', 'rejected'),
  (217, 'Sanya Gill', 'sanya@paytrust.test', @pw, 'user', 'verified'),
  (218, 'Yash Pandey', 'yash@paytrust.test', @pw, 'user', 'verified'),
  (219, 'Aisha Khan', 'aisha@paytrust.test', @pw, 'user', 'verified'),
  (220, 'Dev Mehta', 'dev@paytrust.test', @pw, 'user', 'pending');

INSERT INTO wallets (user_id) SELECT id FROM users WHERE id BETWEEN 201 AND 220;

-- ---- top-ups ----
SET @app_user_id = 201;
CALL add_funds(201, 30000.00, 'bulk-topup-1');
SET @app_user_id = 202;
CALL add_funds(202, 40000.00, 'bulk-topup-2');
SET @app_user_id = 203;
CALL add_funds(203, 30000.00, 'bulk-topup-3');
SET @app_user_id = 204;
CALL add_funds(204, 30000.00, 'bulk-topup-4');
SET @app_user_id = 205;
CALL add_funds(205, 40000.00, 'bulk-topup-5');
SET @app_user_id = 206;
CALL add_funds(206, 40000.00, 'bulk-topup-6');
SET @app_user_id = 207;
CALL add_funds(207, 20000.00, 'bulk-topup-7');
SET @app_user_id = 208;
CALL add_funds(208, 20000.00, 'bulk-topup-8');
SET @app_user_id = 209;
CALL add_funds(209, 40000.00, 'bulk-topup-9');
SET @app_user_id = 210;
CALL add_funds(210, 30000.00, 'bulk-topup-10');
SET @app_user_id = 211;
CALL add_funds(211, 50000.00, 'bulk-topup-11');
SET @app_user_id = 212;
CALL add_funds(212, 40000.00, 'bulk-topup-12');
SET @app_user_id = 213;
CALL add_funds(213, 20000.00, 'bulk-topup-13');
SET @app_user_id = 214;
CALL add_funds(214, 15000.00, 'bulk-topup-14');
SET @app_user_id = 215;
CALL add_funds(215, 30000.00, 'bulk-topup-15');
SET @app_user_id = 216;
CALL add_funds(216, 25000.00, 'bulk-topup-16');
SET @app_user_id = 217;
CALL add_funds(217, 20000.00, 'bulk-topup-17');
SET @app_user_id = 218;
CALL add_funds(218, 15000.00, 'bulk-topup-18');
SET @app_user_id = 219;
CALL add_funds(219, 40000.00, 'bulk-topup-19');
SET @app_user_id = 220;
CALL add_funds(220, 50000.00, 'bulk-topup-20');
SET @app_user_id = 202;
CALL add_funds(202, 5000.00, 'bulk-topup-21');
SET @app_user_id = 213;
CALL add_funds(213, 5000.00, 'bulk-topup-22');
SET @app_user_id = 215;
CALL add_funds(215, 5000.00, 'bulk-topup-23');
SET @app_user_id = 206;
CALL add_funds(206, 5000.00, 'bulk-topup-24');
SET @app_user_id = 201;
CALL add_funds(201, 5000.00, 'bulk-topup-25');
SET @app_user_id = 214;
CALL add_funds(214, 10000.00, 'bulk-topup-26');
SET @app_user_id = 209;
CALL add_funds(209, 10000.00, 'bulk-topup-27');
SET @app_user_id = 220;
CALL add_funds(220, 10000.00, 'bulk-topup-28');

-- ---- peer-to-peer transfers ----
SET @app_user_id = 219;
SET @wf = (SELECT id FROM wallets WHERE user_id = 219 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 2000.00, 'bulk-xfer-29');
SET @app_user_id = 208;
SET @wf = (SELECT id FROM wallets WHERE user_id = 208 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 210 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1200.00, 'bulk-xfer-30');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1200.00, 'bulk-xfer-31');
SET @app_user_id = 209;
SET @wf = (SELECT id FROM wallets WHERE user_id = 209 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 214 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 2000.00, 'bulk-xfer-32');
SET @app_user_id = 203;
SET @wf = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 209 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 750.00, 'bulk-xfer-33');
SET @app_user_id = 208;
SET @wf = (SELECT id FROM wallets WHERE user_id = 208 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 217 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-34');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-35');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 204 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-36');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 100.00, 'bulk-xfer-37');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-38');
SET @app_user_id = 202;
SET @wf = (SELECT id FROM wallets WHERE user_id = 202 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 216 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1000.00, 'bulk-xfer-39');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 214 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-40');
SET @app_user_id = 219;
SET @wf = (SELECT id FROM wallets WHERE user_id = 219 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-41');
SET @app_user_id = 211;
SET @wf = (SELECT id FROM wallets WHERE user_id = 211 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-42');
SET @app_user_id = 211;
SET @wf = (SELECT id FROM wallets WHERE user_id = 211 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1000.00, 'bulk-xfer-43');
SET @app_user_id = 204;
SET @wf = (SELECT id FROM wallets WHERE user_id = 204 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 205 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-44');
SET @app_user_id = 204;
SET @wf = (SELECT id FROM wallets WHERE user_id = 204 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 100.00, 'bulk-xfer-45');
SET @app_user_id = 215;
SET @wf = (SELECT id FROM wallets WHERE user_id = 215 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 216 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-46');
SET @app_user_id = 218;
SET @wf = (SELECT id FROM wallets WHERE user_id = 218 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1200.00, 'bulk-xfer-47');
SET @app_user_id = 217;
SET @wf = (SELECT id FROM wallets WHERE user_id = 217 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-48');
SET @app_user_id = 214;
SET @wf = (SELECT id FROM wallets WHERE user_id = 214 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-49');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 214 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-50');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 209 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-51');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-52');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 219 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-53');
SET @app_user_id = 202;
SET @wf = (SELECT id FROM wallets WHERE user_id = 202 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 205 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-54');
SET @app_user_id = 215;
SET @wf = (SELECT id FROM wallets WHERE user_id = 215 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 209 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 100.00, 'bulk-xfer-55');
SET @app_user_id = 220;
SET @wf = (SELECT id FROM wallets WHERE user_id = 220 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 211 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-56');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-57');
SET @app_user_id = 203;
SET @wf = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-58');
SET @app_user_id = 201;
SET @wf = (SELECT id FROM wallets WHERE user_id = 201 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 212 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 750.00, 'bulk-xfer-59');
SET @app_user_id = 220;
SET @wf = (SELECT id FROM wallets WHERE user_id = 220 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 215 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-60');
SET @app_user_id = 219;
SET @wf = (SELECT id FROM wallets WHERE user_id = 219 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 216 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-61');
SET @app_user_id = 213;
SET @wf = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 206 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 250.00, 'bulk-xfer-62');
SET @app_user_id = 210;
SET @wf = (SELECT id FROM wallets WHERE user_id = 210 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 208 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 300.00, 'bulk-xfer-63');
SET @app_user_id = 207;
SET @wf = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 206 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 2000.00, 'bulk-xfer-64');
SET @app_user_id = 207;
SET @wf = (SELECT id FROM wallets WHERE user_id = 207 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1200.00, 'bulk-xfer-65');
SET @app_user_id = 220;
SET @wf = (SELECT id FROM wallets WHERE user_id = 220 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1000.00, 'bulk-xfer-66');
SET @app_user_id = 202;
SET @wf = (SELECT id FROM wallets WHERE user_id = 202 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 204 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-67');
SET @app_user_id = 202;
SET @wf = (SELECT id FROM wallets WHERE user_id = 202 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 217 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-68');
SET @app_user_id = 208;
SET @wf = (SELECT id FROM wallets WHERE user_id = 208 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 213 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-69');
SET @app_user_id = 214;
SET @wf = (SELECT id FROM wallets WHERE user_id = 214 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 216 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-70');
SET @app_user_id = 217;
SET @wf = (SELECT id FROM wallets WHERE user_id = 217 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 206 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 150.00, 'bulk-xfer-71');
SET @app_user_id = 205;
SET @wf = (SELECT id FROM wallets WHERE user_id = 205 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 208 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 1200.00, 'bulk-xfer-72');
SET @app_user_id = 218;
SET @wf = (SELECT id FROM wallets WHERE user_id = 218 AND wallet_type = 'user');
SET @wt = (SELECT id FROM wallets WHERE user_id = 203 AND wallet_type = 'user');
CALL process_transfer(@wf, @wt, 500.00, 'bulk-xfer-73');

-- ---- escrows in every state ----
-- escrow 1: Logo design (created)
SET @app_user_id = 201;
CALL create_escrow('manav@paytrust.test', 2500.00, 'Logo design', 'Three logo concepts and final files', 'bulk-create-74');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 201);
-- escrow 2: Python tutoring (refunded)
SET @app_user_id = 210;
CALL create_escrow('vikram@paytrust.test', 500.00, 'Python tutoring', 'Six one-hour sessions', 'bulk-create-75');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 210);
SET @app_user_id = 210;
CALL fund_escrow(@e, 'bulk-fund-76');
SET @app_user_id = 202;
CALL complete_escrow(@e);
SET @app_user_id = 202;
CALL refund_escrow(@e, 'bulk-refund-77');
-- escrow 3: Used bicycle (disp_release)
SET @app_user_id = 203;
CALL create_escrow('manav@paytrust.test', 800.00, 'Used bicycle', 'Hero 21-speed, pickup from hostel', 'bulk-create-78');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 203);
SET @app_user_id = 203;
CALL fund_escrow(@e, 'bulk-fund-79');
SET @app_user_id = 216;
CALL complete_escrow(@e);
SET @app_user_id = 216;
CALL dispute_escrow(@e);
SET @app_user_id = 101;
CALL resolve_dispute(@e, 'release', 'bulk-resolve-80');
-- escrow 4: Wedding photos (completed)
SET @app_user_id = 211;
CALL create_escrow('sneha@paytrust.test', 800.00, 'Wedding photos', '200 edited photos, soft copy', 'bulk-create-81');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 211);
SET @app_user_id = 211;
CALL fund_escrow(@e, 'bulk-fund-82');
SET @app_user_id = 205;
CALL complete_escrow(@e);
-- escrow 5: Resume review (created)
SET @app_user_id = 203;
CALL create_escrow('neha@paytrust.test', 2500.00, 'Resume review', 'Two rounds of feedback', 'bulk-create-83');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 203);
-- escrow 6: Website landing page (completed)
SET @app_user_id = 202;
CALL create_escrow('sneha@paytrust.test', 2500.00, 'Website landing page', 'Responsive page with contact form', 'bulk-create-84');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 202);
SET @app_user_id = 202;
CALL fund_escrow(@e, 'bulk-fund-85');
SET @app_user_id = 205;
CALL complete_escrow(@e);
-- escrow 7: Textbook set (released)
SET @app_user_id = 212;
CALL create_escrow('ishita@paytrust.test', 4500.00, 'Textbook set', 'Sem 5 books, good condition', 'bulk-create-86');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 212);
SET @app_user_id = 212;
CALL fund_escrow(@e, 'bulk-fund-87');
SET @app_user_id = 203;
CALL complete_escrow(@e);
SET @app_user_id = 212;
CALL release_escrow(@e, 'bulk-release-88');
-- escrow 8: Video edit (released)
SET @app_user_id = 203;
CALL create_escrow('harsh@paytrust.test', 500.00, 'Video edit', '3-minute reel with captions', 'bulk-create-89');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 203);
SET @app_user_id = 203;
CALL fund_escrow(@e, 'bulk-fund-90');
SET @app_user_id = 214;
CALL complete_escrow(@e);
SET @app_user_id = 203;
CALL release_escrow(@e, 'bulk-release-91');
-- escrow 9: Poster design (completed)
SET @app_user_id = 216;
CALL create_escrow('aisha@paytrust.test', 500.00, 'Poster design', 'A2 size, print-ready PDF', 'bulk-create-92');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 216);
SET @app_user_id = 216;
CALL fund_escrow(@e, 'bulk-fund-93');
SET @app_user_id = 219;
CALL complete_escrow(@e);
-- escrow 10: Guitar lessons (released)
SET @app_user_id = 220;
CALL create_escrow('riya@paytrust.test', 3000.00, 'Guitar lessons', 'Four weekend sessions', 'bulk-create-94');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 220);
SET @app_user_id = 220;
CALL fund_escrow(@e, 'bulk-fund-95');
SET @app_user_id = 213;
CALL complete_escrow(@e);
SET @app_user_id = 220;
CALL release_escrow(@e, 'bulk-release-96');
-- escrow 11: Data entry (released)
SET @app_user_id = 219;
CALL create_escrow('ananya@paytrust.test', 800.00, 'Data entry', '500 records into a spreadsheet', 'bulk-create-97');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 219);
SET @app_user_id = 219;
CALL fund_escrow(@e, 'bulk-fund-98');
SET @app_user_id = 201;
CALL complete_escrow(@e);
SET @app_user_id = 219;
CALL release_escrow(@e, 'bulk-release-99');
-- escrow 12: Translation work (disp_release)
SET @app_user_id = 203;
CALL create_escrow('dev@paytrust.test', 800.00, 'Translation work', 'Hindi to English, 10 pages', 'bulk-create-100');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 203);
SET @app_user_id = 203;
CALL fund_escrow(@e, 'bulk-fund-101');
SET @app_user_id = 220;
CALL complete_escrow(@e);
SET @app_user_id = 220;
CALL dispute_escrow(@e);
SET @app_user_id = 101;
CALL resolve_dispute(@e, 'release', 'bulk-resolve-102');
-- escrow 13: Mobile app bug fixes (released)
SET @app_user_id = 214;
CALL create_escrow('kavya@paytrust.test', 3000.00, 'Mobile app bug fixes', 'Fix login and crash issues', 'bulk-create-103');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 214);
SET @app_user_id = 214;
CALL fund_escrow(@e, 'bulk-fund-104');
SET @app_user_id = 211;
CALL complete_escrow(@e);
SET @app_user_id = 214;
CALL release_escrow(@e, 'bulk-release-105');
-- escrow 14: Birthday cake order (refunded)
SET @app_user_id = 219;
CALL create_escrow('neha@paytrust.test', 4500.00, 'Birthday cake order', '1 kg chocolate cake, delivered', 'bulk-create-106');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 219);
SET @app_user_id = 219;
CALL fund_escrow(@e, 'bulk-fund-107');
SET @app_user_id = 215;
CALL refund_escrow(@e, 'bulk-refund-108');
-- escrow 15: Lab report help (released)
SET @app_user_id = 218;
CALL create_escrow('ishita@paytrust.test', 500.00, 'Lab report help', 'Proofreading and formatting', 'bulk-create-109');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 218);
SET @app_user_id = 218;
CALL fund_escrow(@e, 'bulk-fund-110');
SET @app_user_id = 203;
CALL complete_escrow(@e);
SET @app_user_id = 218;
CALL release_escrow(@e, 'bulk-release-111');
-- escrow 16: Phone stand (funded)
SET @app_user_id = 210;
CALL create_escrow('ishita@paytrust.test', 4500.00, 'Phone stand', '3D printed, two pieces', 'bulk-create-112');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 210);
SET @app_user_id = 210;
CALL fund_escrow(@e, 'bulk-fund-113');
-- escrow 17: Podcast intro music (funded)
SET @app_user_id = 201;
CALL create_escrow('nikhil@paytrust.test', 800.00, 'Podcast intro music', '30-second original track', 'bulk-create-114');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 201);
SET @app_user_id = 201;
CALL fund_escrow(@e, 'bulk-fund-115');
-- escrow 18: Math assignment (released)
SET @app_user_id = 216;
CALL create_escrow('dev@paytrust.test', 2000.00, 'Math assignment', 'Linear algebra problem set', 'bulk-create-116');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 216);
SET @app_user_id = 216;
CALL fund_escrow(@e, 'bulk-fund-117');
SET @app_user_id = 220;
CALL complete_escrow(@e);
SET @app_user_id = 216;
CALL release_escrow(@e, 'bulk-release-118');
-- escrow 19: Logo design (created)
SET @app_user_id = 201;
CALL create_escrow('siddharth@paytrust.test', 2000.00, 'Logo design', 'Three logo concepts and final files', 'bulk-create-119');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 201);
-- escrow 20: Python tutoring (funded)
SET @app_user_id = 205;
CALL create_escrow('pooja@paytrust.test', 1200.00, 'Python tutoring', 'Six one-hour sessions', 'bulk-create-120');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 205);
SET @app_user_id = 205;
CALL fund_escrow(@e, 'bulk-fund-121');
-- escrow 21: Used bicycle (released)
SET @app_user_id = 211;
CALL create_escrow('neha@paytrust.test', 4500.00, 'Used bicycle', 'Hero 21-speed, pickup from hostel', 'bulk-create-122');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 211);
SET @app_user_id = 211;
CALL fund_escrow(@e, 'bulk-fund-123');
SET @app_user_id = 215;
CALL complete_escrow(@e);
SET @app_user_id = 211;
CALL release_escrow(@e, 'bulk-release-124');
-- escrow 22: Wedding photos (completed)
SET @app_user_id = 208;
CALL create_escrow('kavya@paytrust.test', 3000.00, 'Wedding photos', '200 edited photos, soft copy', 'bulk-create-125');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 208);
SET @app_user_id = 208;
CALL fund_escrow(@e, 'bulk-fund-126');
SET @app_user_id = 211;
CALL complete_escrow(@e);
-- escrow 23: Resume review (funded)
SET @app_user_id = 209;
CALL create_escrow('pooja@paytrust.test', 3000.00, 'Resume review', 'Two rounds of feedback', 'bulk-create-127');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 209);
SET @app_user_id = 209;
CALL fund_escrow(@e, 'bulk-fund-128');
-- escrow 24: Website landing page (created)
SET @app_user_id = 207;
CALL create_escrow('dev@paytrust.test', 3000.00, 'Website landing page', 'Responsive page with contact form', 'bulk-create-129');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 207);
-- escrow 25: Textbook set (created)
SET @app_user_id = 208;
CALL create_escrow('aisha@paytrust.test', 2500.00, 'Textbook set', 'Sem 5 books, good condition', 'bulk-create-130');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 208);
-- escrow 26: Video edit (refunded)
SET @app_user_id = 207;
CALL create_escrow('sneha@paytrust.test', 1200.00, 'Video edit', '3-minute reel with captions', 'bulk-create-131');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 207);
SET @app_user_id = 207;
CALL fund_escrow(@e, 'bulk-fund-132');
SET @app_user_id = 205;
CALL refund_escrow(@e, 'bulk-refund-133');
-- escrow 27: Poster design (disp_refund)
SET @app_user_id = 202;
CALL create_escrow('ishita@paytrust.test', 2000.00, 'Poster design', 'A2 size, print-ready PDF', 'bulk-create-134');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 202);
SET @app_user_id = 202;
CALL fund_escrow(@e, 'bulk-fund-135');
SET @app_user_id = 203;
CALL complete_escrow(@e);
SET @app_user_id = 202;
CALL dispute_escrow(@e);
SET @app_user_id = 101;
CALL resolve_dispute(@e, 'refund', 'bulk-resolve-136');
-- escrow 28: Guitar lessons (funded)
SET @app_user_id = 204;
CALL create_escrow('neha@paytrust.test', 4500.00, 'Guitar lessons', 'Four weekend sessions', 'bulk-create-137');
SET @e = (SELECT MAX(id) FROM escrows WHERE buyer_id = 204);
SET @app_user_id = 204;
CALL fund_escrow(@e, 'bulk-fund-138');

-- ---- account states for the admin screens ----
UPDATE users SET is_active = FALSE WHERE id = 220;
SET @app_user_id = NULL;

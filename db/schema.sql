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

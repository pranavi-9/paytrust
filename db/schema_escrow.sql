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

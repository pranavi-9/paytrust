-- PayTrust: ledger queries (Member A). Run after procedures + seed. Replace :w with a wallet id.

-- Q1. Wallet statement with running balance (window function)
SELECT le.id, le.created_at, t.type, le.entry_type, le.amount,
       SUM(CASE le.entry_type WHEN 'credit' THEN le.amount ELSE -le.amount END)
         OVER (ORDER BY le.created_at, le.id) AS running_balance
FROM ledger_entries le JOIN transactions t ON t.id = le.transaction_id
WHERE le.wallet_id = 3 ORDER BY le.created_at, le.id;

-- Q2. Reconciliation: any wallet whose cached balance disagrees with the ledger (expect 0 rows)
SELECT * FROM wallet_balance_summary WHERE difference <> 0;

-- Q3. Double-entry proof: transactions without exactly one debit + one credit of equal amount (expect 0 rows)
SELECT transaction_id FROM ledger_entries GROUP BY transaction_id
HAVING SUM(entry_type='debit') <> 1 OR SUM(entry_type='credit') <> 1
    OR SUM(IF(entry_type='debit', amount, -amount)) <> 0;

-- Q4. Money currently locked in escrow must equal the escrow wallet balance
SELECT (SELECT COALESCE(SUM(amount),0) FROM escrows WHERE status IN ('funded','completed','disputed')) AS locked_in_escrows,
       (SELECT balance FROM wallets WHERE wallet_type='escrow') AS escrow_wallet_balance;

-- Q5. Top senders per month with rank (CTE + window function)
WITH monthly AS (
  SELECT DATE_FORMAT(created_at,'%Y-%m') AS month, from_wallet_id, SUM(amount) AS sent
  FROM transactions WHERE type = 'transfer' GROUP BY month, from_wallet_id)
SELECT month, from_wallet_id, sent, RANK() OVER (PARTITION BY month ORDER BY sent DESC) AS rnk FROM monthly;

-- Q6. Users with more than one escrow role, and their net position (joins + aggregates)
SELECT u.full_name,
       SUM(CASE WHEN e.buyer_id = u.id  AND e.status IN ('funded','completed','disputed') THEN e.amount ELSE 0 END) AS locked_as_buyer,
       SUM(CASE WHEN e.seller_id = u.id AND e.status = 'released' THEN e.amount ELSE 0 END) AS earned_as_seller
FROM users u LEFT JOIN escrows e ON u.id IN (e.buyer_id, e.seller_id)
GROUP BY u.id, u.full_name HAVING COUNT(e.id) > 0;

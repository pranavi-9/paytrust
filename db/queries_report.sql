-- =====================================================================
-- PayTrust: report queries (Member A)
--   mysql -u root -p paytrust < db/queries_report.sql
-- Read-only. Shows the query types asked for in the rubric:
--   R1 nested subquery, R2 correlated subquery, R3 recursive CTE (date series),
--   R4 recursive CTE (money trail), R5 INNER/LEFT/multi-table joins,
--   R6 set-style filter with NOT EXISTS, R7 GROUP BY / HAVING.
-- =====================================================================

-- R1. NESTED subquery: users whose wallet balance is above the average
--     balance of all user wallets.
SELECT u.id, u.full_name, w.balance
  FROM users u
  JOIN wallets w ON w.user_id = u.id
 WHERE w.wallet_type = 'user'
   AND w.balance > (SELECT AVG(balance) FROM wallets WHERE wallet_type = 'user')
 ORDER BY w.balance DESC;

-- R2. CORRELATED subquery: for each user, their largest single transfer sent,
--     found by a subquery that refers to the outer row.
SELECT u.id, u.full_name,
       (SELECT MAX(t.amount)
          FROM transactions t
         WHERE t.type = 'transfer' AND t.from_wallet_id = w.id) AS largest_transfer_sent
  FROM users u
  JOIN wallets w ON w.user_id = u.id AND w.wallet_type = 'user'
 WHERE u.role = 'user'
 ORDER BY largest_transfer_sent DESC
 LIMIT 8;

-- R2b. CORRELATED EXISTS: users who have sold something (were the seller on a
--      released escrow).
SELECT u.id, u.full_name
  FROM users u
 WHERE EXISTS (SELECT 1 FROM escrows e
                WHERE e.seller_id = u.id AND e.status = 'released')
 ORDER BY u.id;

-- R3. RECURSIVE CTE (date series): daily money moved for the last 10 days of
--     activity, including days with no transactions (they show 0).
WITH RECURSIVE days (d) AS (
  SELECT DATE((SELECT MAX(created_at) FROM transactions)) - INTERVAL 9 DAY
  UNION ALL
  SELECT d + INTERVAL 1 DAY FROM days
   WHERE d < DATE((SELECT MAX(created_at) FROM transactions))
)
SELECT days.d AS day, COUNT(t.id) AS txns, COALESCE(SUM(t.amount), 0) AS moved
  FROM days
  LEFT JOIN transactions t
         ON DATE(t.created_at) = days.d AND t.type IN ('transfer', 'escrow_fund')
 GROUP BY days.d
 ORDER BY days.d;

-- R4. RECURSIVE CTE (graph walk): where can money sent by user 102 end up?
--     Follows user-to-user transfers up to 3 hops. The path column stops
--     cycles (a wallet already on the path is not visited again).
WITH RECURSIVE trail (wallet_id, hops, path) AS (
  SELECT id, 0, CAST(id AS CHAR(200)) FROM wallets WHERE user_id = 102 AND wallet_type = 'user'
  UNION ALL
  SELECT t.to_wallet_id, tr.hops + 1, CONCAT(tr.path, '>', t.to_wallet_id)
    FROM trail tr
    JOIN transactions t ON t.from_wallet_id = tr.wallet_id AND t.type = 'transfer'
   WHERE tr.hops < 3
     AND FIND_IN_SET(t.to_wallet_id, REPLACE(tr.path, '>', ',')) = 0
)
SELECT tr.hops, u.full_name AS reached_user, tr.path
  FROM trail tr
  JOIN wallets w ON w.id = tr.wallet_id
  JOIN users u ON u.id = w.user_id
 WHERE tr.hops > 0
 GROUP BY tr.hops, u.full_name, tr.path
 ORDER BY tr.hops, u.full_name
 LIMIT 12;

-- R5. JOINS: INNER (escrow with buyer and seller names) and LEFT (users who
--     never sent money still appear, with 0).
SELECT e.id, e.title, e.amount, e.status, b.full_name AS buyer, s.full_name AS seller
  FROM escrows e
  JOIN users b ON b.id = e.buyer_id
  JOIN users s ON s.id = e.seller_id
 ORDER BY e.id
 LIMIT 8;

SELECT u.id, u.full_name, COUNT(t.id) AS transfers_sent
  FROM users u
  JOIN wallets w ON w.user_id = u.id AND w.wallet_type = 'user'
  LEFT JOIN transactions t ON t.from_wallet_id = w.id AND t.type = 'transfer'
 GROUP BY u.id, u.full_name
 ORDER BY transfers_sent, u.id
 LIMIT 6;

-- R6. NOT EXISTS: verified users who have never opened an escrow as buyer.
SELECT u.id, u.full_name
  FROM users u
 WHERE u.role = 'user' AND u.kyc_status = 'verified'
   AND NOT EXISTS (SELECT 1 FROM escrows e WHERE e.buyer_id = u.id)
 ORDER BY u.id;

-- R7. GROUP BY / HAVING: escrow count and value per status, only statuses
--     with at least 2 escrows.
SELECT status, COUNT(*) AS escrows, SUM(amount) AS total_amount
  FROM escrows
 GROUP BY status
HAVING COUNT(*) >= 2
 ORDER BY total_amount DESC;

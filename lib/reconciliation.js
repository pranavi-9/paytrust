// Ledger health check shared by the admin API route and the reconciliation page (Member A).
// Caller must already have checked that the user is an admin.
import { query } from './mysql';

export async function getReconciliation() {
  const [wallets, [unbalanced], [sum]] = await Promise.all([
    query(
      `SELECT s.wallet_id, s.user_id, s.wallet_type, u.full_name,
              s.cached_balance, s.ledger_derived_balance, s.difference
         FROM wallet_balance_summary s
         LEFT JOIN users u ON u.id = s.user_id
        ORDER BY s.wallet_id`
    ),
    // Every transaction must have exactly one debit and one credit of equal amount.
    query(
      `SELECT COUNT(*) AS bad FROM (
         SELECT transaction_id FROM ledger_entries GROUP BY transaction_id
         HAVING SUM(entry_type = 'debit') <> 1 OR SUM(entry_type = 'credit') <> 1
             OR SUM(IF(entry_type = 'debit', amount, -amount)) <> 0) x`
    ),
    query('SELECT SUM(balance) AS total FROM wallets'),
  ]);
  const mismatchedWallets = wallets.filter((w) => Number(w.difference) !== 0).length;
  const unbalancedTransactions = Number(unbalanced.bad);
  const sumOfAllBalances = sum.total ?? '0.00';
  return {
    wallets,
    mismatchedWallets,
    unbalancedTransactions,
    sumOfAllBalances,
    healthy: mismatchedWallets === 0 && unbalancedTransactions === 0 && Number(sumOfAllBalances) === 0,
  };
}

import { withActor } from '@/lib/mysql';
import { errorResponse, LedgerError } from '@/lib/ledger';
import { getActorId } from '@/lib/dev-auth';   // TODO: swap for Member B's session helper

// GET /api/admin/reconciliation  (admin only)
export async function GET(request) {
  try {
    const actor = getActorId(request);
    const data = await withActor(actor, async (conn) => {
      const [[u]] = await conn.query('SELECT role FROM users WHERE id=?', [actor]);
      if (!u || u.role !== 'admin') throw new LedgerError('FORBIDDEN', 'admin only', 403);
      const [wallets] = await conn.query('SELECT * FROM wallet_balance_summary ORDER BY wallet_id');
      const [[t]] = await conn.query('SELECT COUNT(*) AS bad FROM (SELECT transaction_id FROM ledger_entries GROUP BY transaction_id HAVING SUM(entry_type=\'debit\')<>1 OR SUM(entry_type=\'credit\')<>1 OR SUM(IF(entry_type=\'debit\',amount,-amount))<>0) x');
      const [[s]] = await conn.query('SELECT SUM(balance) AS total FROM wallets');
      return {
        wallets,
        mismatchedWallets: wallets.filter((w) => String(w.difference) !== '0.00').length,
        unbalancedTransactions: t.bad,
        sumOfAllBalances: s.total,
        healthy: wallets.every((w) => String(w.difference) === '0.00') && t.bad === 0 && Number(s.total) === 0,
      };
    });
    return Response.json(data);
  } catch (e) { return errorResponse(e); }
}

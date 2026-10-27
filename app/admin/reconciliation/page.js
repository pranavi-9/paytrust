import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { formatINR } from '@/lib/format';
import { getReconciliation } from '@/lib/reconciliation';
import Nav from '../../components/Nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Reconciliation · PayTrust' };

const TYPE_LABEL = { user: 'User wallet', escrow: 'Escrow holding', topup: 'Top-up source' };

export default async function ReconciliationPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/dashboard'); // second guard after proxy.js

  const r = await getReconciliation();

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <div className="page-head">
          <div>
            <h1>Ledger reconciliation</h1>
            <p className="muted" style={{ margin: 0 }}>
              Every wallet’s stored balance is checked against the sum of its ledger entries.
            </p>
          </div>
          <span className={`badge ${r.healthy ? 'released' : 'disputed'}`}>
            {r.healthy ? 'Healthy' : 'Mismatch found'}
          </span>
        </div>

        <div className="stats" style={{ marginTop: 16 }}>
          <div className="card stat">
            <span className="muted">Wallets out of balance</span>
            <strong className={r.mismatchedWallets === 0 ? 'ok' : 'bad'}>{r.mismatchedWallets}</strong>
          </div>
          <div className="card stat">
            <span className="muted">Unbalanced transactions</span>
            <strong className={r.unbalancedTransactions === 0 ? 'ok' : 'bad'}>{r.unbalancedTransactions}</strong>
          </div>
          <div className="card stat">
            <span className="muted">Sum of all balances (must be ₹0.00)</span>
            <strong className={Number(r.sumOfAllBalances) === 0 ? 'ok' : 'bad'}>{formatINR(r.sumOfAllBalances)}</strong>
          </div>
        </div>

        <h2>Wallets</h2>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>Wallet</th><th>Owner</th><th>Stored balance</th><th>From ledger</th><th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {r.wallets.map((w) => {
                const ok = Number(w.difference) === 0;
                return (
                  <tr key={w.wallet_id}>
                    <td>#{w.wallet_id} <span className="muted">· {TYPE_LABEL[w.wallet_type] ?? w.wallet_type}</span></td>
                    <td>{w.full_name ?? <span className="muted">system</span>}</td>
                    <td className="num">{formatINR(w.cached_balance)}</td>
                    <td className="num">{formatINR(w.ledger_derived_balance)}</td>
                    <td className={`num ${ok ? 'ok' : 'bad'}`}>{formatINR(w.difference)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small-text">
          The top-up wallet is negative by design: it is where simulated deposits come from, so all wallets together always add up to zero.
        </p>
      </main>
    </>
  );
}

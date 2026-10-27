'use client';
import { useEffect, useState } from 'react';

export default function ReconciliationPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/admin/reconciliation')
      .then((r) => r.json().then((j) => (r.ok ? j : Promise.reject(j.error?.message || 'Failed'))))
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p style={{ padding: 24, color: 'crimson' }}>Error: {error}</p>;
  if (!data) return <p style={{ padding: 24 }}>Loading…</p>;

  return (
    <main style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <h1>Ledger reconciliation</h1>
      <p style={{
        display: 'inline-block', padding: '6px 14px', borderRadius: 6, color: 'white',
        background: data.healthy ? '#15803d' : '#b91c1c'
      }}>
        {data.healthy ? 'Healthy: ledger matches every wallet' : 'Mismatch found'}
      </p>
      <ul>
        <li>Wallets with a mismatch: {data.mismatchedWallets}</li>
        <li>Unbalanced transactions: {data.unbalancedTransactions}</li>
        <li>Sum of all balances (must be 0.00): {data.sumOfAllBalances}</li>
      </ul>
      <table border="1" cellPadding="8" style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr><th>Wallet</th><th>Type</th><th>User</th><th>Cached</th><th>From ledger</th><th>Difference</th></tr>
        </thead>
        <tbody>
          {data.wallets.map((w) => (
            <tr key={w.wallet_id} style={{ background: w.difference === '0.00' ? 'transparent' : '#fee2e2' }}>
              <td>{w.wallet_id}</td><td>{w.wallet_type}</td><td>{w.user_id ?? '—'}</td>
              <td>{w.cached_balance}</td><td>{w.ledger_derived_balance}</td><td>{w.difference}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import Nav from '../components/Nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'History · PayTrust' };

const PER_PAGE = 25;
const FILTERS = {
  all: { label: 'All', types: null },
  topup: { label: 'Added money', types: ['topup'] },
  transfer: { label: 'Transfers', types: ['transfer'] },
  escrow: { label: 'Escrow', types: ['escrow_fund', 'escrow_release', 'escrow_refund'] },
};

// Plain-language description of one ledger entry, from this user's side.
function describe(r) {
  const other = r.other_name ?? 'someone';
  const deal = r.escrow_title ? `“${r.escrow_title}”` : 'an escrow';
  switch (r.type) {
    case 'topup': return 'Added money';
    case 'transfer': return r.entry_type === 'debit' ? `Sent to ${other}` : `Received from ${other}`;
    case 'escrow_fund': return `Paid into escrow for ${deal}`;
    case 'escrow_release': return `Escrow released: ${deal}`;
    case 'escrow_refund': return `Escrow refunded: ${deal}`;
    default: return r.type;
  }
}

export default async function TransactionsPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  const sp = await searchParams;
  const filter = FILTERS[sp.type] ? sp.type : 'all';
  const page = Math.max(1, Math.min(1000, Number.parseInt(sp.page, 10) || 1));

  const [wallet] = await query("SELECT id, balance FROM wallets WHERE user_id = ? AND wallet_type = 'user' LIMIT 1", [session.userId]);
  if (!wallet) redirect('/dashboard');

  const types = FILTERS[filter].types;
  const typeClause = types ? `AND t.type IN (${types.map(() => '?').join(',')})` : '';
  const params = [wallet.id, ...(types ?? [])];

  const [rows, [count], [totals]] = await Promise.all([
    // One row per ledger entry on this wallet. The "other side" is the wallet at
    // the opposite end of the same transaction; escrow names come from the escrow
    // that this transaction funded or settled.
    query(
      `SELECT le.id, le.created_at, le.entry_type, le.amount, le.balance_after,
              t.id AS txn_id, t.type,
              ou.full_name AS other_name,
              COALESCE(ef.id, es.id) AS escrow_id,
              COALESCE(ef.title, es.title) AS escrow_title
         FROM ledger_entries le
         JOIN transactions t ON t.id = le.transaction_id
         JOIN wallets ow ON ow.id = IF(le.entry_type = 'debit', t.to_wallet_id, t.from_wallet_id)
         LEFT JOIN users ou ON ou.id = ow.user_id
         LEFT JOIN escrows ef ON ef.fund_txn_id = t.id
         LEFT JOIN escrows es ON es.settle_txn_id = t.id
        WHERE le.wallet_id = ? ${typeClause}
        ORDER BY le.created_at DESC, le.id DESC
        LIMIT ? OFFSET ?`,
      [...params, String(PER_PAGE), String((page - 1) * PER_PAGE)]
    ),
    query(
      `SELECT COUNT(*) AS n FROM ledger_entries le JOIN transactions t ON t.id = le.transaction_id
        WHERE le.wallet_id = ? ${typeClause}`,
      params
    ),
    // Money in and out over the whole history (all types), for the summary cards.
    query(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount END), 0) AS money_in,
              COALESCE(SUM(CASE WHEN entry_type = 'debit'  THEN amount END), 0) AS money_out
         FROM ledger_entries WHERE wallet_id = ?`,
      [wallet.id]
    ),
  ]);

  const total = Number(count.n);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const link = (p, f = filter) => {
    const q = new URLSearchParams();
    if (f !== 'all') q.set('type', f);
    if (p > 1) q.set('page', String(p));
    const s = q.toString();
    return s ? `/transactions?${s}` : '/transactions';
  };

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <h1>History</h1>
        <p className="muted">Every movement in your wallet, straight from the ledger.</p>

        <div className="stats">
          <div className="card stat"><span className="muted">Balance now</span><strong>{formatINR(wallet.balance)}</strong></div>
          <div className="card stat"><span className="muted">Total money in</span><strong className="ok">{formatINR(totals.money_in)}</strong></div>
          <div className="card stat"><span className="muted">Total money out</span><strong>{formatINR(totals.money_out)}</strong></div>
        </div>

        <div className="chips">
          {Object.entries(FILTERS).map(([key, f]) => (
            <Link key={key} href={link(1, key)} className={`chip ${key === filter ? 'on' : ''}`}>{f.label}</Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="card muted">No transactions{filter === 'all' ? ' yet. Add money from the dashboard to get started.' : ' of this kind.'}</p>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>When</th><th>What</th><th>Amount</th><th>Balance after</th><th>Ref</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="muted">{new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td>
                      {r.escrow_id ? <Link href={`/escrows/${r.escrow_id}`}>{describe(r)}</Link> : describe(r)}
                    </td>
                    <td className={`num ${r.entry_type === 'credit' ? 'ok' : ''}`}>
                      {r.entry_type === 'credit' ? '+' : '−'}{formatINR(r.amount)}
                    </td>
                    <td className="num">{formatINR(r.balance_after)}</td>
                    <td className="muted">#{r.txn_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="actions" style={{ alignItems: 'center' }}>
            {page > 1 ? <Link className="btn small" href={link(page - 1)}>← Newer</Link> : null}
            <span className="muted">Page {page} of {pages}</span>
            {page < pages ? <Link className="btn small" href={link(page + 1)}>Older →</Link> : null}
          </div>
        )}
      </main>
    </>
  );
}

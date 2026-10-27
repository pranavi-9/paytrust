import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import { getEscrow, disputesCollection } from '@/lib/disputes';
import Nav from '../../components/Nav';
import EscrowActions from './EscrowActions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Escrow · PayTrust' };

const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '—');

export default async function EscrowDetailPage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  const escrowId = Number(id);
  if (!Number.isInteger(escrowId) || escrowId <= 0) notFound();

  const escrow = await getEscrow(escrowId);
  const me = session.userId;
  const isAdmin = session.role === 'admin';
  // Not yours = not found, so other users' escrow ids can't be probed.
  if (!escrow || (!isAdmin && escrow.buyer_id !== me && escrow.seller_id !== me)) notFound();

  const role = isAdmin ? 'admin' : escrow.buyer_id === me ? 'buyer' : 'seller';

  // Status history from the audit trigger (Member B), with who made each change.
  const history = await query(
    `SELECT a.old_status, a.new_status, a.changed_at, u.full_name AS changed_by
       FROM escrow_status_audit a
       LEFT JOIN users u ON u.id = a.changed_by
      WHERE a.escrow_id = ?
      ORDER BY a.changed_at, a.id`,
    [escrowId]
  );

  // Latest dispute case for this escrow, if any (MongoDB).
  let dispute = null;
  try {
    const col = await disputesCollection();
    dispute = await col.findOne({ escrow_id: escrowId }, { sort: { created_at: -1 }, projection: { status: 1, reason: 1 } });
  } catch (err) {
    console.error('could not load dispute for escrow', escrowId, err.message);
  }
  const canDispute = role !== 'admin' && ['funded', 'completed'].includes(escrow.status) && (!dispute || dispute.status === 'resolved');

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <Link className="back" href={isAdmin ? '/admin' : '/escrows'}>← {isAdmin ? 'Admin' : 'All escrows'}</Link>
        <div className="page-head">
          <div>
            <h1>{escrow.title}</h1>
            <p className="muted" style={{ margin: 0 }}>Escrow #{escrow.id}{role !== 'admin' && ` · you are the ${role}`}</p>
          </div>
          <span className={`badge ${escrow.status}`}>{escrow.status}</span>
        </div>

        <div className="card">
          <div className="amount-lg">{formatINR(escrow.amount)}</div>
          {escrow.description && <p>{escrow.description}</p>}
          <dl className="detail-grid">
            <div><dt>Buyer</dt><dd>{escrow.buyer_name}</dd></div>
            <div><dt>Seller</dt><dd>{escrow.seller_name}</dd></div>
            <div><dt>Created</dt><dd>{fmt(escrow.created_at)}</dd></div>
            <div><dt>Funded</dt><dd>{fmt(escrow.funded_at)}</dd></div>
            <div><dt>Completed</dt><dd>{fmt(escrow.completed_at)}</dd></div>
            <div><dt>Settled</dt><dd>{fmt(escrow.settled_at)}</dd></div>
          </dl>
        </div>

        {/* Member A's buttons: fund, mark complete, release, refund */}
        <EscrowActions escrow={{ id: escrow.id, status: escrow.status, amount: String(escrow.amount) }} role={role} />

        {dispute ? (
          <div className={`card callout ${dispute.status === 'resolved' ? 'done' : 'warn'}`}>
            <strong>Dispute </strong>
            <span className={`badge ${dispute.status}`}>{dispute.status.replace('_', ' ')}</span>
            <p style={{ margin: '8px 0 0' }}><Link href={`/disputes/${dispute._id}`}>Open the dispute case →</Link></p>
          </div>
        ) : null}
        {canDispute && (
          <div className="actions">
            <Link className="btn" href={`/disputes/new?escrow=${escrow.id}`}>Raise a dispute</Link>
          </div>
        )}

        <h2>Status history</h2>
        <div className="card table-wrap">
          <table>
            <thead><tr><th>Change</th><th>By</th><th>When</th></tr></thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td>
                    {h.old_status ? <span className={`badge ${h.old_status}`}>{h.old_status}</span> : <span className="muted">new</span>}
                    {' → '}
                    <span className={`badge ${h.new_status}`}>{h.new_status}</span>
                  </td>
                  <td>{h.changed_by ?? 'system'}</td>
                  <td className="muted">{fmt(h.changed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

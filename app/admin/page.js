import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import Link from 'next/link';
import Nav from '../components/Nav';
import { REASONS, ACTIVE, disputesCollection } from '@/lib/disputes';
import { userNames, escrowTitles } from '@/lib/names';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Admin · PayTrust' };

const STATUSES = ['created', 'funded', 'completed', 'disputed', 'released', 'refunded'];

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/dashboard'); // second guard after proxy.js

  const [[userCount], byStatus, recentAudit] = await Promise.all([
    query("SELECT COUNT(*) AS n FROM users WHERE role = 'user'"),
    // Escrow count and value per status.
    query(
      `SELECT status, COUNT(*) AS n, SUM(amount) AS total
         FROM escrows
        GROUP BY status`
    ),
    // Latest status changes from the audit trigger, with who made them.
    query(
      `SELECT a.escrow_id, a.old_status, a.new_status, a.changed_at,
              COALESCE(u.full_name, 'system') AS changed_by
         FROM escrow_status_audit a
         LEFT JOIN users u ON u.id = a.changed_by
        ORDER BY a.changed_at DESC, a.id DESC
        LIMIT 10`
    ),
  ]);

  const statusMap = Object.fromEntries(byStatus.map((r) => [r.status, r]));

  // Dispute queue: active cases from MongoDB, oldest first (first come, first served).
  const col = await disputesCollection();
  const queue = await col
    .find({ status: { $in: ACTIVE } }, { projection: { escrow_id: 1, raised_by: 1, reason: 1, status: 1, created_at: 1, messages: { $slice: -1 } } })
    .sort({ created_at: 1 })
    .toArray();
  // Escrows disputed in MySQL but with no active case in MongoDB (should not
  // happen; shown so an admin notices if the two databases ever disagree).
  const disputedRows = await query("SELECT id FROM escrows WHERE status = 'disputed'");
  const withCase = new Set(queue.map((c) => c.escrow_id));
  const orphans = disputedRows.map((r) => Number(r.id)).filter((id) => !withCase.has(id));
  const [qNames, qEscrows] = await Promise.all([
    userNames(queue.map((c) => c.raised_by)),
    escrowTitles([...queue.map((c) => c.escrow_id), ...orphans]),
  ]);
  const ageOf = (d) => {
    const h = Math.floor((Date.now() - d.getTime()) / 3_600_000);
    return h < 1 ? 'under 1 h' : h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`;
  };

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <h1>Admin</h1>
        <p className="muted">{Number(userCount.n)} registered users</p>

        <h2 id="disputes">Dispute queue</h2>
        {queue.length === 0 && orphans.length === 0 ? (
          <p className="card muted">No open disputes.</p>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>Escrow</th><th>Amount</th><th>Raised by</th><th>Reason</th><th>Status</th><th>Waiting</th></tr>
              </thead>
              <tbody>
                {queue.map((c) => (
                  <tr key={String(c._id)}>
                    <td><Link href={`/disputes/${c._id}`}>{qEscrows[c.escrow_id]?.title ?? `Escrow #${c.escrow_id}`}</Link></td>
                    <td className="num">{formatINR(qEscrows[c.escrow_id]?.amount)}</td>
                    <td>{qNames[c.raised_by]}</td>
                    <td>{REASONS[c.reason]}</td>
                    <td><span className={`badge ${c.status}`}>{c.status.replace('_', ' ')}</span></td>
                    <td className="muted">{ageOf(c.created_at)}</td>
                  </tr>
                ))}
                {orphans.map((id) => (
                  <tr key={`o${id}`}>
                    <td><Link href={`/escrows/${id}`}>{qEscrows[id]?.title ?? `Escrow #${id}`}</Link></td>
                    <td className="num">{formatINR(qEscrows[id]?.amount)}</td>
                    <td colSpan={4} className="bad">Disputed in MySQL but no case in MongoDB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h2>Escrows by status</h2>
        <div className="stats six">
          {STATUSES.map((s) => (
            <div key={s} className="card stat">
              <span className={`badge ${s}`}>{s}</span>
              <strong>{Number(statusMap[s]?.n ?? 0)}</strong>
              <span className="muted small-text">{formatINR(statusMap[s]?.total ?? '0.00')}</span>
            </div>
          ))}
        </div>

        <h2>Recent status changes</h2>
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Escrow</th><th>Change</th><th>By</th><th>When</th></tr>
            </thead>
            <tbody>
              {recentAudit.map((a, i) => (
                <tr key={i}>
                  <td><Link href={`/escrows/${a.escrow_id}`}>#{a.escrow_id}</Link></td>
                  <td>
                    {a.old_status ? <span className={`badge ${a.old_status}`}>{a.old_status}</span> : <span className="muted">new</span>}
                    {' → '}
                    <span className={`badge ${a.new_status}`}>{a.new_status}</span>
                  </td>
                  <td>{a.changed_by}</td>
                  <td className="muted">{new Date(a.changed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="muted">Dispute analytics arrive in week 4.</p>
      </main>
    </>
  );
}

import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import Nav from '../components/Nav';

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

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <h1>Admin</h1>
        <p className="muted">{Number(userCount.n)} registered users</p>

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
                  <td>#{a.escrow_id}</td>
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

        <p className="muted">Dispute queue and analytics arrive in weeks 3 and 4.</p>
      </main>
    </>
  );
}

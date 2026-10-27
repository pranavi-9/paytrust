import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import Nav from '../components/Nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dashboard · PayTrust' };

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect('/login'); // proxy.js already checks; this is a second guard
  if (session.role === 'admin') redirect('/admin');

  const [wallet] = await query('SELECT id, balance FROM wallets WHERE user_id = ? LIMIT 1', [session.userId]);

  // My escrows, newest first, with the other party's name.
  const escrows = await query(
    `SELECT e.id, e.title, e.amount, e.status, e.created_at,
            IF(e.buyer_id = ?, 'buying', 'selling') AS my_role,
            other.full_name AS other_party
       FROM escrows e
       JOIN users other ON other.id = IF(e.buyer_id = ?, e.seller_id, e.buyer_id)
      WHERE e.buyer_id = ? OR e.seller_id = ?
      ORDER BY e.created_at DESC
      LIMIT 10`,
    [session.userId, session.userId, session.userId, session.userId]
  );

  const active = escrows.filter((e) => ['created', 'funded', 'completed', 'disputed'].includes(e.status)).length;

  return (
    <>
      <Nav session={session} />
      <main>
        <h1>Hi, {session.name.split(' ')[0]}</h1>
        <p className="muted">Here’s your wallet and recent escrows.</p>

        <div className="stats">
          <div className="card stat">
            <span className="muted">Wallet balance</span>
            <strong>{formatINR(wallet?.balance)}</strong>
          </div>
          <div className="card stat">
            <span className="muted">Active escrows</span>
            <strong>{active}</strong>
          </div>
        </div>

        <div className="actions">
          <Link className="btn primary" href="/send">Send money</Link>
          <Link className="btn" href="/escrows">View all escrows</Link>
        </div>

        <h2>Recent escrows</h2>
        {escrows.length === 0 ? (
          <p className="card muted">No escrows yet.</p>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Title</th><th>With</th><th>Amount</th><th>Status</th></tr>
              </thead>
              <tbody>
                {escrows.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{e.id}</td>
                    <td>{e.title}<div className="muted small-text">{e.my_role}</div></td>
                    <td>{e.other_party}</td>
                    <td className="num">{formatINR(e.amount)}</td>
                    <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

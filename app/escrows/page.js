import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import Nav from '../components/Nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Escrows · PayTrust' };

const FILTERS = ['all', 'created', 'funded', 'completed', 'disputed', 'released', 'refunded'];

export default async function EscrowsPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  const { status = 'all' } = await searchParams;
  const filter = FILTERS.includes(status) ? status : 'all';

  const params = [session.userId, session.userId, session.userId, session.userId];
  let statusClause = '';
  if (filter !== 'all') {
    statusClause = 'AND e.status = ?';
    params.push(filter);
  }

  const escrows = await query(
    `SELECT e.id, e.title, e.amount, e.status, e.created_at,
            IF(e.buyer_id = ?, 'buying', 'selling') AS my_role,
            other.full_name AS other_party
       FROM escrows e
       JOIN users other ON other.id = IF(e.buyer_id = ?, e.seller_id, e.buyer_id)
      WHERE (e.buyer_id = ? OR e.seller_id = ?) ${statusClause}
      ORDER BY e.created_at DESC`,
    params
  );

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <div className="page-head">
          <h1>Escrows</h1>
          <Link className="btn primary" href="/escrows/new">New escrow</Link>
        </div>
        <div className="chips">
          {FILTERS.map((f) => (
            <Link key={f} href={f === 'all' ? '/escrows' : `/escrows?status=${f}`} className={`chip ${f === filter ? 'on' : ''}`}>
              {f}
            </Link>
          ))}
        </div>

        {escrows.length === 0 ? (
          <p className="card muted">No escrows {filter === 'all' ? 'yet' : `with status “${filter}”`}.</p>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Title</th><th>Role</th><th>With</th><th>Amount</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {escrows.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{e.id}</td>
                    <td><Link href={`/escrows/${e.id}`}>{e.title}</Link></td>
                    <td>{e.my_role}</td>
                    <td>{e.other_party}</td>
                    <td className="num">{formatINR(e.amount)}</td>
                    <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                    <td className="muted">{new Date(e.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
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

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import { likeParam, listUrl } from '@/lib/search';
import Nav from '../../components/Nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Escrows · PayTrust admin' };

const FILTERS = ['all', 'created', 'funded', 'completed', 'disputed', 'released', 'refunded'];
// Sort options map to fixed SQL, so user input never becomes part of the query.
const SORTS = {
  newest: { label: 'Newest', sql: 'e.created_at DESC, e.id DESC' },
  oldest: { label: 'Oldest', sql: 'e.created_at ASC, e.id ASC' },
  amount: { label: 'Largest amount', sql: 'e.amount DESC, e.id DESC' },
};

export default async function AdminEscrowsPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/dashboard');

  const sp = await searchParams;
  const filter = FILTERS.includes(sp.status) ? sp.status : 'all';
  const sort = SORTS[sp.sort] ? sp.sort : 'newest';
  const q = String(sp.q ?? '').trim().slice(0, 100);

  const where = ['1 = 1'];
  const params = [];
  if (filter !== 'all') { where.push('e.status = ?'); params.push(filter); }
  const like = likeParam(q);
  if (like) { where.push('(e.title LIKE ? OR b.full_name LIKE ? OR s.full_name LIKE ?)'); params.push(like, like, like); }

  const [escrows, [sum]] = await Promise.all([
    query(
      `SELECT e.id, e.title, e.amount, e.status, e.created_at, b.full_name AS buyer, s.full_name AS seller
         FROM escrows e
         JOIN users b ON b.id = e.buyer_id
         JOIN users s ON s.id = e.seller_id
        WHERE ${where.join(' AND ')}
        ORDER BY ${SORTS[sort].sql}
        LIMIT 200`,
      params
    ),
    query(
      `SELECT COUNT(*) AS n, COALESCE(SUM(e.amount), 0) AS total
         FROM escrows e JOIN users b ON b.id = e.buyer_id JOIN users s ON s.id = e.seller_id
        WHERE ${where.join(' AND ')}`,
      params
    ),
  ]);

  const url = (over) => listUrl('/admin/escrows', { status: filter, sort, q, ...over }, { status: 'all', sort: 'newest' });

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <h1>All escrows</h1>
        <p className="muted">{Number(sum.n)} escrow{Number(sum.n) === 1 ? '' : 's'} · {formatINR(sum.total)} in total</p>

        <form className="search" action="/admin/escrows">
          <input name="q" defaultValue={q} placeholder="Search by title, buyer or seller" aria-label="Search escrows" />
          {filter !== 'all' && <input type="hidden" name="status" value={filter} />}
          {sort !== 'newest' && <input type="hidden" name="sort" value={sort} />}
          <button className="btn" type="submit">Search</button>
          {q && <Link className="btn" href={url({ q: '' })}>Clear</Link>}
        </form>

        <div className="chips">
          {FILTERS.map((f) => <Link key={f} href={url({ status: f })} className={`chip ${f === filter ? 'on' : ''}`}>{f}</Link>)}
        </div>
        <div className="chips" style={{ marginTop: -8 }}>
          {Object.entries(SORTS).map(([k, s]) => <Link key={k} href={url({ sort: k })} className={`chip ${k === sort ? 'on' : ''}`}>{s.label}</Link>)}
        </div>

        {escrows.length === 0 ? (
          <p className="card muted">No escrows match.</p>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Title</th><th>Buyer</th><th>Seller</th><th>Amount</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {escrows.map((e) => (
                  <tr key={e.id}>
                    <td className="muted">{e.id}</td>
                    <td><Link href={`/escrows/${e.id}`}>{e.title}</Link></td>
                    <td>{e.buyer}</td>
                    <td>{e.seller}</td>
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

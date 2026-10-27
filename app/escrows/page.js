import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import { likeParam, listUrl } from '@/lib/search';
import Nav from '../components/Nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Escrows · PayTrust' };

const FILTERS = ['all', 'created', 'funded', 'completed', 'disputed', 'released', 'refunded'];
const ROLES = { all: 'Buying and selling', buying: 'Buying', selling: 'Selling' };

export default async function EscrowsPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin/escrows');

  const sp = await searchParams;
  const filter = FILTERS.includes(sp.status) ? sp.status : 'all';
  const role = ROLES[sp.role] ? sp.role : 'all';
  const q = String(sp.q ?? '').trim().slice(0, 100);
  const me = session.userId;

  const where = [];
  const params = [me, me];
  if (role === 'buying') { where.push('e.buyer_id = ?'); params.push(me); }
  else if (role === 'selling') { where.push('e.seller_id = ?'); params.push(me); }
  else { where.push('(e.buyer_id = ? OR e.seller_id = ?)'); params.push(me, me); }
  if (filter !== 'all') { where.push('e.status = ?'); params.push(filter); }
  const like = likeParam(q);
  if (like) { where.push('(e.title LIKE ? OR other.full_name LIKE ?)'); params.push(like, like); }

  const escrows = await query(
    `SELECT e.id, e.title, e.amount, e.status, e.created_at,
            IF(e.buyer_id = ?, 'buying', 'selling') AS my_role,
            other.full_name AS other_party
       FROM escrows e
       JOIN users other ON other.id = IF(e.buyer_id = ?, e.seller_id, e.buyer_id)
      WHERE ${where.join(' AND ')}
      ORDER BY e.created_at DESC, e.id DESC`,
    params
  );

  const url = (over) => listUrl('/escrows', { status: filter, role, q, ...over }, { status: 'all', role: 'all' });
  const filtered = filter !== 'all' || role !== 'all' || q;

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <div className="page-head">
          <h1>Escrows</h1>
          <Link className="btn primary" href="/escrows/new">New escrow</Link>
        </div>

        <form className="search" action="/escrows">
          <input name="q" defaultValue={q} placeholder="Search by title or person" aria-label="Search escrows" />
          {filter !== 'all' && <input type="hidden" name="status" value={filter} />}
          {role !== 'all' && <input type="hidden" name="role" value={role} />}
          <button className="btn" type="submit">Search</button>
          {filtered && <Link className="btn" href="/escrows">Clear</Link>}
        </form>

        <div className="chips">
          {FILTERS.map((f) => (
            <Link key={f} href={url({ status: f })} className={`chip ${f === filter ? 'on' : ''}`}>{f}</Link>
          ))}
        </div>
        <div className="chips" style={{ marginTop: -8 }}>
          {Object.entries(ROLES).map(([k, label]) => (
            <Link key={k} href={url({ role: k })} className={`chip ${k === role ? 'on' : ''}`}>{label}</Link>
          ))}
        </div>

        {escrows.length === 0 ? (
          <p className="card muted">{filtered ? 'No escrows match.' : 'No escrows yet.'}</p>
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

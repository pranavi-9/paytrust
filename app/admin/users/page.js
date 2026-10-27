import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import { kycCollection } from '@/lib/kyc';
import { likeParam } from '@/lib/search';
import Nav from '../../components/Nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Users · PayTrust admin' };

const KYC_FILTERS = ['all', 'pending', 'verified', 'rejected'];

export default async function AdminUsersPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/dashboard');

  const sp = await searchParams;
  const q = String(sp.q ?? '').trim().slice(0, 100);
  const kyc = KYC_FILTERS.includes(sp.kyc) ? sp.kyc : 'all';
  const frozenOnly = sp.frozen === '1';

  // Search and filters are added as parameters, never pasted into the SQL.
  const where = ["u.role = 'user'"];
  const params = [];
  const like = likeParam(q);
  if (like) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ?)');
    params.push(like, like);
  }
  if (kyc !== 'all') { where.push('u.kyc_status = ?'); params.push(kyc); }
  if (frozenOnly) where.push('u.is_active = FALSE');

  const users = await query(
    `SELECT u.id, u.full_name, u.email, u.kyc_status, u.is_active, u.created_at,
            w.balance,
            (SELECT COUNT(*) FROM escrows e WHERE e.buyer_id = u.id OR e.seller_id = u.id) AS escrow_count
       FROM users u
       LEFT JOIN wallets w ON w.user_id = u.id AND w.wallet_type = 'user'
      WHERE ${where.join(' AND ')}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT 200`,
    params
  );

  // Users with a KYC document waiting for review (MongoDB).
  const col = await kycCollection();
  const waiting = new Set((await col.distinct('user_id', { status: 'pending' })).map(Number));

  const link = (over) => {
    const p = new URLSearchParams();
    const v = { q, kyc, frozen: frozenOnly ? '1' : '', ...over };
    if (v.q) p.set('q', v.q);
    if (v.kyc && v.kyc !== 'all') p.set('kyc', v.kyc);
    if (v.frozen) p.set('frozen', v.frozen);
    const s = p.toString();
    return s ? `/admin/users?${s}` : '/admin/users';
  };

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <h1>Users</h1>
        <p className="muted">{waiting.size} user{waiting.size === 1 ? '' : 's'} with a KYC document waiting for review.</p>

        <form className="search" action="/admin/users">
          <input name="q" defaultValue={q} placeholder="Search by name or email" aria-label="Search users" />
          {kyc !== 'all' && <input type="hidden" name="kyc" value={kyc} />}
          {frozenOnly && <input type="hidden" name="frozen" value="1" />}
          <button className="btn" type="submit">Search</button>
          {q && <Link className="btn" href={link({ q: '' })}>Clear</Link>}
        </form>

        <div className="chips">
          {KYC_FILTERS.map((k) => (
            <Link key={k} href={link({ kyc: k })} className={`chip ${k === kyc ? 'on' : ''}`}>KYC: {k}</Link>
          ))}
          <Link href={link({ frozen: frozenOnly ? '' : '1' })} className={`chip ${frozenOnly ? 'on' : ''}`}>Frozen only</Link>
        </div>

        {users.length === 0 ? (
          <p className="card muted">No users match.</p>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Email</th><th>Balance</th><th>Escrows</th><th>KYC</th><th>Account</th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td><Link href={`/admin/users/${u.id}`}>{u.full_name}</Link></td>
                    <td className="muted">{u.email}</td>
                    <td className="num">{formatINR(u.balance)}</td>
                    <td className="num">{Number(u.escrow_count)}</td>
                    <td>
                      <span className={`badge kyc-${u.kyc_status}`}>{u.kyc_status}</span>
                      {waiting.has(Number(u.id)) && <span className="badge open" style={{ marginLeft: 6 }}>to review</span>}
                    </td>
                    <td>{u.is_active ? <span className="muted">active</span> : <span className="badge disputed">frozen</span>}</td>
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

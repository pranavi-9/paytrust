import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import { getDb, collections } from '@/lib/mongo';
import { DOC_TYPES, kycCollection, serializeDoc } from '@/lib/kyc';
import Nav from '../../../components/Nav';
import { KycReview, FreezeToggle } from './AdminUserActions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'User · PayTrust admin' };

const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

export default async function AdminUserPage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/dashboard');

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) notFound();

  const [user] = await query(
    `SELECT u.id, u.full_name, u.email, u.kyc_status, u.is_active, u.created_at, w.balance
       FROM users u LEFT JOIN wallets w ON w.user_id = u.id AND w.wallet_type = 'user'
      WHERE u.id = ? AND u.role = 'user'`,
    [userId]
  );
  if (!user) notFound();

  const [escrows, kycDocs, activity] = await Promise.all([
    query(
      `SELECT e.id, e.title, e.amount, e.status, IF(e.buyer_id = ?, 'buyer', 'seller') AS role
         FROM escrows e WHERE e.buyer_id = ? OR e.seller_id = ?
        ORDER BY e.created_at DESC LIMIT 20`,
      [userId, userId, userId]
    ),
    kycCollection().then((c) => c.find({ user_id: userId }).sort({ submitted_at: -1 }).toArray()),
    getDb().then((db) => db.collection(collections.activity).find({ user_id: userId }).sort({ created_at: -1 }).limit(15).toArray()),
  ]);
  const docs = kycDocs.map(serializeDoc);

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <Link className="back" href="/admin/users">← All users</Link>
        <div className="page-head">
          <div>
            <h1>{user.full_name}</h1>
            <p className="muted" style={{ margin: 0 }}>{user.email} · joined {new Date(user.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' })}</p>
          </div>
          <span className={`badge kyc-${user.kyc_status}`}>KYC {user.kyc_status}</span>
        </div>

        <div className="stats">
          <div className="card stat"><span className="muted">Wallet balance</span><strong>{formatINR(user.balance)}</strong></div>
          <div className="card stat">
            <span className="muted">Account</span>
            <strong className={user.is_active ? 'ok' : 'bad'}>{user.is_active ? 'Active' : 'Frozen'}</strong>
            <FreezeToggle userId={String(user.id)} active={Boolean(user.is_active)} name={user.full_name} />
          </div>
        </div>

        <h2>KYC documents</h2>
        {docs.length === 0 ? (
          <p className="card muted">No documents submitted.</p>
        ) : (
          docs.map((d) => (
            <div key={d.id} className={`card ${d.status === 'pending' ? 'callout' : ''}`}>
              <div className="page-head">
                <strong>{DOC_TYPES[d.doc_type]} · <span className="num">{d.number_masked}</span></strong>
                <span className={`badge kyc-${d.status}`}>{d.status}</span>
              </div>
              <p style={{ margin: '6px 0' }}>
                <a href={d.file_url} target="_blank" rel="noopener noreferrer nofollow">Open document</a>
                <span className="muted small-text"> · submitted {fmt(d.submitted_at)}</span>
              </p>
              {d.rejection_reason && <p className="bad small-text" style={{ margin: 0 }}>Rejected: {d.rejection_reason}</p>}
              {d.status === 'pending' && <KycReview docId={d.id} />}
            </div>
          ))
        )}

        <div className="split">
          <section>
            <h2>Escrows</h2>
            <div className="card table-wrap">
              {escrows.length === 0 ? <p className="muted" style={{ padding: '0 16px' }}>None.</p> : (
                <table>
                  <tbody>
                    {escrows.map((e) => (
                      <tr key={e.id}>
                        <td><Link href={`/escrows/${e.id}`}>{e.title}</Link><div className="muted small-text">{e.role}</div></td>
                        <td className="num">{formatINR(e.amount)}</td>
                        <td><span className={`badge ${e.status}`}>{e.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
          <section>
            <h2>Recent activity</h2>
            <div className="card table-wrap">
              {activity.length === 0 ? <p className="muted" style={{ padding: '0 16px' }}>No activity logged.</p> : (
                <table>
                  <tbody>
                    {activity.map((a) => (
                      <tr key={String(a._id)}>
                        <td><code>{a.action}</code></td>
                        <td className="muted">{fmt(a.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

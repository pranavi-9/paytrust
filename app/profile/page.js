import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { DOC_TYPES, kycCollection, serializeDoc } from '@/lib/kyc';
import Nav from '../components/Nav';
import KycForm from './KycForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Profile · PayTrust' };

const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const KYC_TEXT = {
  verified: 'Your identity is verified.',
  pending: 'Not verified yet. Submit a document below, or wait for the admin to review it.',
  rejected: 'Your last document was rejected. See the reason below and submit again.',
};

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  const [user] = await query('SELECT full_name, email, kyc_status, is_active, created_at FROM users WHERE id = ?', [session.userId]);
  if (!user) redirect('/login');

  const col = await kycCollection();
  const docs = (await col.find({ user_id: session.userId }).sort({ submitted_at: -1 }).toArray()).map(serializeDoc);
  // Types the user may (re)submit: never submitted, or rejected.
  const blocked = new Set(docs.filter((d) => d.status !== 'rejected').map((d) => d.doc_type));
  const available = Object.fromEntries(Object.entries(DOC_TYPES).filter(([k]) => !blocked.has(k)));

  return (
    <>
      <Nav session={session} />
      <main>
        <h1>Profile</h1>

        {!user.is_active && (
          <p className="card callout warn">
            <strong>Your account is frozen.</strong> You can look around, but you can’t send, receive or move money until an admin unfreezes it.
          </p>
        )}

        <div className="card">
          <dl className="detail-grid">
            <div><dt>Name</dt><dd>{user.full_name}</dd></div>
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Member since</dt><dd>{new Date(user.created_at).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' })}</dd></div>
          </dl>
        </div>

        <h2>Identity verification (KYC)</h2>
        <div className={`card callout ${user.kyc_status === 'verified' ? 'done' : user.kyc_status === 'rejected' ? 'warn' : ''}`}>
          <span className={`badge kyc-${user.kyc_status}`}>{user.kyc_status}</span>
          <p style={{ margin: '8px 0 0' }}>{KYC_TEXT[user.kyc_status]}</p>
        </div>

        {docs.length > 0 && (
          <div className="card table-wrap">
            <table>
              <thead><tr><th>Document</th><th>Number</th><th>Submitted</th><th>Status</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td><a href={d.file_url} target="_blank" rel="noopener noreferrer nofollow">{DOC_TYPES[d.doc_type]}</a></td>
                    <td className="num">{d.number_masked}</td>
                    <td className="muted">{fmt(d.submitted_at)}</td>
                    <td>
                      <span className={`badge kyc-${d.status}`}>{d.status}</span>
                      {d.rejection_reason && <div className="bad small-text" style={{ whiteSpace: 'normal' }}>{d.rejection_reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {user.kyc_status !== 'verified' && Object.keys(available).length > 0 && <KycForm docTypes={available} />}
      </main>
    </>
  );
}

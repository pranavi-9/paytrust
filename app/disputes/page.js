import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { formatINR } from '@/lib/format';
import { REASONS, disputesCollection } from '@/lib/disputes';
import { userNames, escrowTitles } from '@/lib/names';
import Nav from '../components/Nav';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Disputes · PayTrust' };

export default async function DisputesPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin#disputes');

  const me = session.userId;
  const col = await disputesCollection();
  const cases = await col
    .find({ $or: [{ raised_by: me }, { against: me }] }, { projection: { messages: 0, evidence: 0 } })
    .sort({ status: 1, updated_at: -1 })
    .toArray();

  const [names, escrows] = await Promise.all([
    userNames(cases.map((c) => (c.raised_by === me ? c.against : c.raised_by))),
    escrowTitles(cases.map((c) => c.escrow_id)),
  ]);

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <h1>Disputes</h1>
        <p className="muted">Disputes you raised or that were raised against you. To raise one, open an escrow and choose “Raise a dispute”.</p>

        {cases.length === 0 ? (
          <p className="card muted">No disputes. 🎉</p>
        ) : (
          <div className="card table-wrap">
            <table>
              <thead>
                <tr><th>Escrow</th><th>With</th><th>Reason</th><th>Amount</th><th>Status</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const e = escrows[c.escrow_id];
                  return (
                    <tr key={String(c._id)}>
                      <td>
                        <Link href={`/disputes/${c._id}`}>{e?.title ?? `Escrow #${c.escrow_id}`}</Link>
                        <div className="muted small-text">{c.raised_by === me ? 'you raised this' : 'raised against you'}</div>
                      </td>
                      <td>{names[c.raised_by === me ? c.against : c.raised_by]}</td>
                      <td>{REASONS[c.reason]}</td>
                      <td className="num">{e ? formatINR(e.amount) : '—'}</td>
                      <td><span className={`badge ${c.status}`}>{c.status.replace('_', ' ')}</span></td>
                      <td className="muted">{c.updated_at.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

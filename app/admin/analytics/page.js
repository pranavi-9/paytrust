import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { formatINR } from '@/lib/format';
import { REASONS } from '@/lib/disputes';
import { userNames } from '@/lib/names';
import { RANGES, getMoneyAnalytics, getDisputeAndActivityAnalytics } from '@/lib/analytics';
import Nav from '../../components/Nav';
import { BarList, Columns } from '../../components/Charts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Analytics · PayTrust admin' };

const STATUS_LABEL = { open: 'Open', under_review: 'Under review', resolved: 'Resolved' };
const num = (v) => Number(v ?? 0);

export default async function AnalyticsPage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/dashboard');

  const sp = await searchParams;
  const range = RANGES[sp.range] ? sp.range : '30d';

  const [money, mongo] = await Promise.all([getMoneyAnalytics(range), getDisputeAndActivityAnalytics(range)]);
  const d = mongo.disputes ?? {};
  const names = await userNames([
    ...(d.mostDisputedUsers ?? []).map((u) => u._id),
    ...mongo.recent.map((a) => a.user_id),
  ]);

  const statusCount = Object.fromEntries((d.byStatus ?? []).map((s) => [s._id, s.count]));
  const totalCases = (d.byStatus ?? []).reduce((a, s) => a + s.count, 0);
  const outcome = Object.fromEntries((d.outcomes ?? []).map((o) => [o._id, o]));
  const resolved = num(outcome.release?.count) + num(outcome.refund?.count);
  const avgHours = resolved
    ? ((num(outcome.release?.count) * num(outcome.release?.avgHoursToResolve) + num(outcome.refund?.count) * num(outcome.refund?.avgHoursToResolve)) / resolved).toFixed(1)
    : null;
  const engagement = d.engagement?.[0];
  const ended = num(money.escrowRate.released) + num(money.escrowRate.refunded);

  return (
    <>
      <Nav session={session} />
      <main className="wide viz">
        <div className="page-head">
          <div>
            <h1>Analytics</h1>
            <p className="muted" style={{ margin: 0 }}>Money from MySQL, disputes and activity from MongoDB.</p>
          </div>
        </div>

        <div className="chips" role="group" aria-label="Time range">
          {Object.entries(RANGES).map(([k, r]) => (
            <Link key={k} href={k === '30d' ? '/admin/analytics' : `/admin/analytics?range=${k}`} className={`chip ${k === range ? 'on' : ''}`}>{r.label}</Link>
          ))}
        </div>

        <h2 style={{ marginTop: 8 }}>Right now</h2>
        <div className="stats">
          <div className="card stat"><span className="muted">Users</span><strong>{num(money.kpi.users)}</strong><span className="muted small-text">{num(money.kpi.verified_users)} KYC verified · {num(money.kpi.frozen_users)} frozen</span></div>
          <div className="card stat"><span className="muted">Held in escrow</span><strong>{formatINR(money.kpi.held_in_escrow)}</strong><span className="muted small-text">{num(money.escrowRate.in_progress)} escrows in progress</span></div>
          <div className="card stat"><span className="muted">In user wallets</span><strong>{formatINR(money.kpi.user_balances)}</strong></div>
          <div className="card stat">
            <span className="muted">Escrows ending in release</span>
            <strong>{ended ? `${Math.round((num(money.escrowRate.released) / ended) * 100)}%` : '—'}</strong>
            <span className="muted small-text">{num(money.escrowRate.released)} released · {num(money.escrowRate.refunded)} refunded</span>
          </div>
        </div>

        <h2>Money · {RANGES[range].label.toLowerCase()}</h2>
        <div className="split">
          <section className="card">
            <h3 className="chart-title">Money moved by type</h3>
            <BarList
              label="Money moved by transaction type"
              rows={money.byType.map((r) => ({ label: r.label, value: Number(r.total), text: formatINR(r.total), hint: `${num(r.n)} transactions` }))}
            />
          </section>
          <section className="card">
            <h3 className="chart-title">Transfers and escrow funding per day</h3>
            <Columns label="Money moved between users per day" rows={money.perDay.map((r) => ({ ...r, value: Number(r.total), text: formatINR(r.total) }))} />
          </section>
        </div>

        <section className="card">
          <h3 className="chart-title">Top senders</h3>
          {money.topSenders.length === 0 ? <p className="muted" style={{ margin: 0 }}>No transfers in this period.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Rank</th><th>User</th><th>Payments</th><th>Total sent</th></tr></thead>
                <tbody>
                  {money.topSenders.map((s) => (
                    <tr key={s.id}>
                      <td>{num(s.rnk)}</td>
                      <td><Link href={`/admin/users/${s.id}`}>{s.full_name}</Link></td>
                      <td className="num">{num(s.n)}</td>
                      <td className="num">{formatINR(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <h2>Disputes · {RANGES[range].label.toLowerCase()}</h2>
        <div className="stats">
          <div className="card stat"><span className="muted">Disputes raised</span><strong>{totalCases}</strong><span className="muted small-text">{num(statusCount.open) + num(statusCount.under_review)} still open</span></div>
          <div className="card stat"><span className="muted">Average time to resolve</span><strong>{avgHours ? `${avgHours} h` : '—'}</strong></div>
          <div className="card stat"><span className="muted">Decided for</span><strong>{resolved ? `${num(outcome.refund?.count)} buyer · ${num(outcome.release?.count)} seller` : '—'}</strong></div>
          <div className="card stat"><span className="muted">Per case</span><strong>{engagement ? `${engagement.avgMessages} msgs` : '—'}</strong><span className="muted small-text">{engagement ? `${engagement.avgEvidence} evidence links on average` : ''}</span></div>
        </div>
        <div className="split">
          <section className="card">
            <h3 className="chart-title">Why disputes are raised</h3>
            <BarList label="Disputes by reason" rows={(d.byReason ?? []).map((r) => ({ label: REASONS[r._id] ?? r._id, value: r.total, text: String(r.total), hint: `${r.unresolved} unresolved` }))} />
          </section>
          <section className="card">
            <h3 className="chart-title">Case status</h3>
            <BarList label="Disputes by status" rows={['open', 'under_review', 'resolved'].filter((s) => statusCount[s]).map((s) => ({ label: STATUS_LABEL[s], value: statusCount[s], text: String(statusCount[s]) }))} />
            {(d.mostDisputedUsers ?? []).length > 0 && (
              <p className="muted small-text" style={{ margin: '12px 0 0' }}>
                Disputed most often: {d.mostDisputedUsers.map((u) => `${names[u._id] ?? 'user ' + u._id} (${u.disputes})`).join(', ')}
              </p>
            )}
          </section>
        </div>

        <h2>Activity · {RANGES[range].label.toLowerCase()}</h2>
        <div className="split">
          <section className="card">
            <h3 className="chart-title">Most common actions</h3>
            <BarList label="Activity by action" rows={mongo.activity.map((a) => ({ label: a._id, value: a.count, text: String(a.count), hint: `${a.users} users` }))} />
          </section>
          <section className="card table-wrap">
            <h3 className="chart-title" style={{ padding: '0 16px' }}>Latest events</h3>
            <table>
              <tbody>
                {mongo.recent.map((a) => (
                  <tr key={String(a._id)}>
                    <td><code>{a.action}</code></td>
                    <td>{a.user_id ? names[a.user_id] ?? `user ${a.user_id}` : <span className="muted">unknown</span>}</td>
                    <td className="muted">{a.created_at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      </main>
    </>
  );
}

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ObjectId } from 'mongodb';
import { getSession } from '@/lib/auth';
import { formatINR } from '@/lib/format';
import { REASONS, getEscrow, disputesCollection, canViewCase, serializeCase } from '@/lib/disputes';
import { userNames } from '@/lib/names';
import Nav from '../../components/Nav';
import { MessageForm, EvidenceForm, ResolvePanel } from './DisputeForms';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Dispute · PayTrust' };

const fmt = (d) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });

export default async function DisputePage({ params }) {
  const session = await getSession();
  if (!session) redirect('/login');

  const { id } = await params;
  if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== id) notFound();

  const col = await disputesCollection();
  const raw = await col.findOne({ _id: new ObjectId(id) });
  if (!raw || !canViewCase(session, raw)) notFound();

  const c = serializeCase(raw);
  const escrow = await getEscrow(c.escrow_id);
  const names = await userNames([
    c.raised_by, c.against,
    ...c.messages.map((m) => m.sender_id),
    ...c.evidence.map((e) => e.uploaded_by),
    c.resolution?.resolved_by,
  ]);
  const nameOf = (uid) => (uid === session.userId ? 'You' : names[uid] ?? 'Admin');

  const isAdmin = session.role === 'admin';
  const open = c.status !== 'resolved';
  const buyerName = escrow?.buyer_name;
  const sellerName = escrow?.seller_name;
  const partyLabel = (uid) => (uid === escrow?.buyer_id ? 'buyer' : uid === escrow?.seller_id ? 'seller' : 'admin');

  return (
    <>
      <Nav session={session} />
      <main className="wide">
        <Link className="back" href={isAdmin ? '/admin#disputes' : '/disputes'}>← {isAdmin ? 'Dispute queue' : 'My disputes'}</Link>
        <div className="page-head">
          <div>
            <h1>Dispute: {escrow?.title ?? `Escrow #${c.escrow_id}`}</h1>
            <p className="muted" style={{ margin: 0 }}>
              Raised by {nameOf(c.raised_by)} ({partyLabel(c.raised_by)}) on {fmt(c.created_at)}
            </p>
          </div>
          <span className={`badge ${c.status}`}>{c.status.replace('_', ' ')}</span>
        </div>

        <div className="card">
          <dl className="detail-grid">
            <div><dt>Amount in escrow</dt><dd>{escrow ? formatINR(escrow.amount) : '—'}</dd></div>
            <div><dt>Buyer</dt><dd>{buyerName}</dd></div>
            <div><dt>Seller</dt><dd>{sellerName}</dd></div>
            <div><dt>Escrow</dt><dd><Link href={`/escrows/${c.escrow_id}`}>#{c.escrow_id}</Link> <span className={`badge ${escrow?.status}`}>{escrow?.status}</span></dd></div>
          </dl>
          <h3 style={{ margin: '16px 0 4px', fontSize: 15 }}>{REASONS[c.reason]}</h3>
          <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.description}</p>
        </div>

        {c.resolution && (
          <div className="card callout done">
            <strong>
              Resolved: {c.resolution.decision === 'release' ? `money released to ${sellerName} (seller)` : `money refunded to ${buyerName} (buyer)`}
            </strong>
            <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{c.resolution.note}</p>
            <p className="muted small-text" style={{ margin: '6px 0 0' }}>
              by {nameOf(c.resolution.resolved_by)} on {fmt(c.resolution.resolved_at)} · ledger transaction #{c.resolution.settle_txn_id}
            </p>
          </div>
        )}

        {isAdmin && open && <ResolvePanel caseId={c.id} amount={escrow ? formatINR(escrow.amount) : ''} buyer={buyerName} seller={sellerName} />}

        <div className="split">
          <section>
            <h2>Messages</h2>
            <div className="card">
              {c.messages.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No messages yet.</p>
              ) : (
                <ul className="thread">
                  {c.messages.map((m, i) => (
                    <li key={i} className={`msg ${m.sender_id === session.userId ? 'mine' : ''} ${partyLabel(m.sender_id) === 'admin' ? 'admin' : ''}`}>
                      <header><strong>{nameOf(m.sender_id)}</strong><span>{partyLabel(m.sender_id)}</span><span>{fmt(m.sent_at)}</span></header>
                      <p>{m.body}</p>
                    </li>
                  ))}
                </ul>
              )}
              {open && <MessageForm caseId={c.id} />}
            </div>
          </section>

          <section>
            <h2>Evidence</h2>
            <div className="card">
              {c.evidence.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No evidence yet.</p>
              ) : (
                <ol className="evidence">
                  {c.evidence.map((e, i) => (
                    <li key={i}>
                      <a href={e.file_url} target="_blank" rel="noopener noreferrer nofollow">{e.caption || e.file_url}</a>
                      <div className="muted small-text">{nameOf(e.uploaded_by)} ({partyLabel(e.uploaded_by)}) · {fmt(e.uploaded_at)}</div>
                    </li>
                  ))}
                </ol>
              )}
              {open && !isAdmin && <EvidenceForm caseId={c.id} />}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

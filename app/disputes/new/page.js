import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { formatINR } from '@/lib/format';
import { getEscrow, REASONS, ACTIVE, disputesCollection } from '@/lib/disputes';
import Nav from '../../components/Nav';
import NewDisputeForm from './NewDisputeForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Raise a dispute · PayTrust' };

export default async function NewDisputePage({ searchParams }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  const { escrow: raw } = await searchParams;
  const escrowId = Number(raw);
  if (!Number.isInteger(escrowId) || escrowId <= 0) notFound();

  const escrow = await getEscrow(escrowId);
  const me = session.userId;
  if (!escrow || (escrow.buyer_id !== me && escrow.seller_id !== me)) notFound();

  // Already an open case? Go straight to it.
  const col = await disputesCollection();
  const existing = await col.findOne({ escrow_id: escrowId, status: { $in: ACTIVE } }, { projection: { _id: 1 } });
  if (existing) redirect(`/disputes/${existing._id}`);

  const allowed = ['funded', 'completed', 'disputed'].includes(escrow.status);
  const other = me === escrow.buyer_id ? escrow.seller_name : escrow.buyer_name;

  return (
    <>
      <Nav session={session} />
      <main className="narrow">
        <Link className="back" href={`/escrows/${escrow.id}`}>← Back to escrow</Link>
        <h1>Raise a dispute</h1>
        <p className="muted">
          {escrow.title} · {formatINR(escrow.amount)} · with {other}
        </p>

        {allowed ? (
          <>
            <div className="card callout">
              The money stays locked in escrow until an admin reviews the case and decides whether it goes to the seller or back to the buyer.
            </div>
            <NewDisputeForm escrowId={escrow.id} reasons={REASONS} />
          </>
        ) : (
          <p className="card callout warn">
            This escrow is <strong>{escrow.status}</strong>. Only a funded or completed escrow can be disputed.
          </p>
        )}
      </main>
    </>
  );
}

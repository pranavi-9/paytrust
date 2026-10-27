import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import Nav from '../../components/Nav';
import NewEscrowForm from './NewEscrowForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New escrow · PayTrust' };

export default async function NewEscrowPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  return (
    <>
      <Nav session={session} />
      <main className="narrow">
        <Link className="back" href="/escrows">← All escrows</Link>
        <h1>New escrow</h1>
        <p className="muted">You’re the buyer. After creating it you fund it, and the money is held until you release it to the seller.</p>
        <NewEscrowForm />
      </main>
    </>
  );
}

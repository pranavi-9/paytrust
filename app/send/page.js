import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/mysql';
import { formatINR } from '@/lib/format';
import Nav from '../components/Nav';
import SendForm from './SendForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Send money · PayTrust' };

export default async function SendPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role === 'admin') redirect('/admin');

  const [wallet] = await query("SELECT id, balance FROM wallets WHERE user_id = ? AND wallet_type = 'user' LIMIT 1", [session.userId]);

  return (
    <>
      <Nav session={session} />
      <main className="narrow">
        <h1>Send money</h1>
        <p className="muted">Available: {formatINR(wallet?.balance)}</p>
        <SendForm fromWalletId={String(wallet?.id ?? '')} />
      </main>
    </>
  );
}

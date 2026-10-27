import Link from 'next/link';
import LogoutButton from './LogoutButton';

export default function Nav({ session }) {
  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href={session.role === 'admin' ? '/admin' : '/dashboard'} className="brand">PayTrust</Link>
        <nav>
          {session.role === 'admin' ? (
            <>
              <Link href="/admin">Admin</Link>
              <Link href="/admin/escrows">Escrows</Link>
              <Link href="/admin/users">Users</Link>
              <Link href="/admin/analytics">Analytics</Link>
              <Link href="/admin/reconciliation">Reconciliation</Link>
            </>
          ) : (
            <>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/send">Send money</Link>
              <Link href="/escrows">Escrows</Link>
              <Link href="/disputes">Disputes</Link>
              <Link href="/transactions">History</Link>
              <Link href="/profile">Profile</Link>
            </>
          )}
        </nav>
        <div className="nav-user">
          <span className="muted">{session.name}</span>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}

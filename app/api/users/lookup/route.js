import { query } from '@/lib/mysql';
import { requireApiSession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/users/lookup?email=diya@paytrust.test
// Finds a recipient for the Send money page: their name (so the sender can
// confirm who they're paying) and wallet id (what /api/transfer needs).
export async function GET(request) {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;

  const email = (new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
  if (!email || email.length > 150) {
    return Response.json({ error: { code: 'INVALID_INPUT', message: 'Enter an email' } }, { status: 400 });
  }

  const rows = await query(
    `SELECT u.id, u.full_name, w.id AS wallet_id
       FROM users u
       JOIN wallets w ON w.user_id = u.id AND w.wallet_type = 'user'
      WHERE u.email = ? AND u.is_active = TRUE AND u.role = 'user'
      LIMIT 1`,
    [email]
  );
  const r = rows[0];
  if (!r) {
    return Response.json({ error: { code: 'NOT_FOUND', message: 'No PayTrust user with that email' } }, { status: 404 });
  }
  if (Number(r.id) === auth.session.userId) {
    return Response.json({ error: { code: 'INVALID_INPUT', message: 'You can’t send money to yourself' } }, { status: 400 });
  }
  return Response.json({ name: r.full_name, walletId: String(r.wallet_id) });
}

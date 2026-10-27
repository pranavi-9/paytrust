import { query } from '@/lib/mysql';
import { requireApiSession } from '@/lib/auth';

export const runtime = 'nodejs';

// GET /api/auth/me  -> the logged-in user, read fresh from the database
export async function GET() {
  const auth = await requireApiSession();
  if (auth.error) return auth.error;

  const rows = await query('SELECT id, full_name, email, role FROM users WHERE id = ?', [auth.session.userId]);
  if (!rows[0]) return Response.json({ error: 'Account not found' }, { status: 401 });

  return Response.json({ user: { ...rows[0], id: Number(rows[0].id) } });
}

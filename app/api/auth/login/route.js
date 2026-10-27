import { cookies } from 'next/headers';
import { query } from '@/lib/mysql';
import { checkPassword } from '@/lib/auth';
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from '@/lib/session';
import { logActivity, clientIp } from '@/lib/activity';

export const runtime = 'nodejs';

// POST /api/auth/login  { email, password }
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send JSON' }, { status: 400 });
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) {
    return Response.json({ error: 'Enter your email and password' }, { status: 422 });
  }

  const rows = await query(
    'SELECT id, full_name, email, password_hash, role FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  const found = rows[0];

  // Always run bcrypt, even for unknown emails (see DUMMY_HASH in lib/auth.js).
  const ok = await checkPassword(password, found?.password_hash);
  const ip = clientIp(request);

  if (!found || !ok) {
    await logActivity({ userId: found ? Number(found.id) : null, action: 'login.failed', ip, metadata: { email } });
    // Same message either way, so attackers can't tell which emails exist.
    return Response.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const user = { id: Number(found.id), full_name: found.full_name, email: found.email, role: found.role };
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(user), sessionCookieOptions);
  await logActivity({ userId: user.id, action: 'login.success', ip });

  return Response.json({ user });
}

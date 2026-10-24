import { cookies } from 'next/headers';
import { pool } from '@/lib/mysql';
import { hashPassword } from '@/lib/auth';
import { SESSION_COOKIE, createSessionToken, sessionCookieOptions } from '@/lib/session';
import { logActivity, clientIp } from '@/lib/activity';

export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register  { full_name, email, password }
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Send JSON' }, { status: 400 });
  }

  const fullName = String(body.full_name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  const errors = {};
  if (fullName.length < 2 || fullName.length > 100) errors.full_name = 'Enter your full name';
  if (!EMAIL_RE.test(email) || email.length > 255) errors.email = 'Enter a valid email';
  if (password.length < 8) errors.password = 'Use at least 8 characters';
  else if (password.length > 72) errors.password = 'Use at most 72 characters';
  if (Object.keys(errors).length) {
    return Response.json({ error: 'Please fix the highlighted fields', fields: errors }, { status: 422 });
  }

  const passwordHash = await hashPassword(password);

  // New user and their empty wallet are created together or not at all.
  // Everyone who registers is a normal user; admins exist only in seed data.
  const conn = await pool.getConnection();
  let userId;
  try {
    await conn.beginTransaction();
    const [res] = await conn.execute(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
      [fullName, email, passwordHash, 'user']
    );
    userId = res.insertId;
    await conn.execute('INSERT INTO wallets (user_id) VALUES (?)', [userId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback().catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return Response.json(
        { error: 'An account with this email already exists', fields: { email: 'Already registered' } },
        { status: 409 }
      );
    }
    console.error('register failed:', err);
    return Response.json({ error: 'Could not create the account' }, { status: 500 });
  } finally {
    conn.release();
  }

  const user = { id: Number(userId), full_name: fullName, email, role: 'user' };
  const store = await cookies();
  store.set(SESSION_COOKIE, await createSessionToken(user), sessionCookieOptions);
  await logActivity({ userId: user.id, action: 'user.register', entityType: 'user', entityId: user.id, ip: clientIp(request) });

  return Response.json({ user }, { status: 201 });
}

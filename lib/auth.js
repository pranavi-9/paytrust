// Server-side auth helpers for pages and API routes.
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken } from './session';

const BCRYPT_ROUNDS = 10;

// Compared against when the email doesn't exist, so a wrong email takes as long
// as a wrong password and response time doesn't reveal which emails are registered.
const DUMMY_HASH = '$2b$10$xb8UrV9xr6pauwuhUy.0ZOB8VwzbFTCvLc.sctfD60dle.dYXt1nC';

export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function checkPassword(plain, hash) {
  return bcrypt.compare(plain, hash || DUMMY_HASH);
}

/** The logged-in user from the session cookie, or null. */
export async function getSession() {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/**
 * For API routes. Usage:
 *   const auth = await requireApiSession('admin');
 *   if (auth.error) return auth.error;
 *   auth.session.userId ...
 */
export async function requireApiSession(role) {
  const session = await getSession();
  if (!session) {
    return { error: Response.json({ error: 'Not logged in' }, { status: 401 }) };
  }
  if (role && session.role !== role) {
    return { error: Response.json({ error: 'Not allowed' }, { status: 403 }) };
  }
  return { session };
}

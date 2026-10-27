// JWT session helpers. Kept free of database imports so proxy.js can use it.
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'pt_session';
export const SESSION_HOURS = 8;

function secretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET is missing or shorter than 16 characters. Set it in .env.');
  }
  return new TextEncoder().encode(secret);
}

/** user: { id, full_name, role } */
export async function createSessionToken(user) {
  return new SignJWT({ role: user.role, name: user.full_name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secretKey());
}

/** Returns { userId, role, name } or null if the token is missing, expired or tampered with. */
export async function verifySessionToken(token) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    return { userId: Number(payload.sub), role: payload.role, name: payload.name };
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true, // JavaScript in the browser can't read it
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_HOURS * 60 * 60,
};

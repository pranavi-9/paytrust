// Route protection (Next 16 renamed middleware.js to proxy.js).
// Runs before pages render: sends logged-out visitors to /login and
// keeps non-admins out of /admin. API routes check auth themselves.
import { NextResponse } from 'next/server';
import { SESSION_COOKIE, verifySessionToken } from './lib/session';

const USER_PAGES = ['/dashboard', '/send', '/escrows', '/disputes'];
const ADMIN_PAGES = ['/admin'];
const GUEST_PAGES = ['/login', '/register'];

const startsWithAny = (path, prefixes) => prefixes.some((p) => path === p || path.startsWith(p + '/'));

export async function proxy(request) {
  const { pathname, search } = request.nextUrl;
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (startsWithAny(pathname, GUEST_PAGES)) {
    return session ? NextResponse.redirect(new URL('/dashboard', request.url)) : NextResponse.next();
  }

  if (!session) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', pathname + search);
    const res = NextResponse.redirect(login);
    // Drop an expired or tampered cookie so it isn't sent again.
    if (request.cookies.has(SESSION_COOKIE)) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  if (startsWithAny(pathname, ADMIN_PAGES) && session.role !== 'admin') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/send/:path*', '/escrows/:path*', '/disputes/:path*', '/admin/:path*', '/login', '/register'],
};

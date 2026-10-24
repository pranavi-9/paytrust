import { cookies } from 'next/headers';
import { SESSION_COOKIE } from '@/lib/session';
import { getSession } from '@/lib/auth';
import { logActivity, clientIp } from '@/lib/activity';

export const runtime = 'nodejs';

// POST /api/auth/logout
export async function POST(request) {
  const session = await getSession();
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  if (session) await logActivity({ userId: session.userId, action: 'logout', ip: clientIp(request) });
  return Response.json({ ok: true });
}

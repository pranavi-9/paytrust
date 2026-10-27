import { errorResponse, parseId, LedgerError } from '@/lib/ledger';
import { requireSession, readJson } from '@/lib/disputes';
import { query } from '@/lib/mysql';
import { logActivity, clientIp } from '@/lib/activity';

export const runtime = 'nodejs';

// POST /api/admin/users/:id/active   { active: true | false }
// Admin freezes or unfreezes a user account. A frozen account can still log
// in and look around, but every money procedure (Member A's _require_actor)
// refuses to act for it, and it can't receive transfers. Admins can't be frozen.
export async function POST(request, { params }) {
  try {
    const session = await requireSession();
    if (session.role !== 'admin') throw new LedgerError('FORBIDDEN', 'admin only', 403);
    const { id } = await params;
    const userId = parseId(id);

    const { active } = await readJson(request);
    if (typeof active !== 'boolean') throw new LedgerError('INVALID_INPUT', 'active must be true or false', 400);

    const res = await query("UPDATE users SET is_active = ? WHERE id = ? AND role = 'user'", [active, userId]);
    if (res.affectedRows === 0) throw new LedgerError('NOT_FOUND', 'user not found', 404);

    await logActivity({ userId: session.userId, action: active ? 'user.unfreeze' : 'user.freeze', entityType: 'user', entityId: userId, ip: clientIp(request) });
    return Response.json({ userId: String(userId), active });
  } catch (e) {
    return errorResponse(e);
  }
}

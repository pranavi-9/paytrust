import { query } from '@/lib/mysql';
import { errorResponse, LedgerError } from '@/lib/ledger';
import { getActorId } from '@/lib/auth';
import { getReconciliation } from '@/lib/reconciliation';

// GET /api/admin/reconciliation  (admin only)
export async function GET() {
  try {
    const actor = await getActorId();
    const [u] = await query('SELECT role FROM users WHERE id = ?', [actor]);
    if (!u || u.role !== 'admin') throw new LedgerError('FORBIDDEN', 'admin only', 403);
    return Response.json(await getReconciliation());
  } catch (e) { return errorResponse(e); }
}

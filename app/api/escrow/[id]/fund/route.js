import { fundEscrow, getKey, parseId, errorResponse, okResponse } from '@/lib/ledger';
import { getActorId } from '@/lib/auth';

// POST /api/escrow/:id/fund   Header: Idempotency-Key
export async function POST(request, { params }) {
  try {
    const actor = await getActorId();
    const { id } = await params;
    return okResponse(await fundEscrow(actor, parseId(id), getKey(request)));
  } catch (e) { return errorResponse(e); }
}

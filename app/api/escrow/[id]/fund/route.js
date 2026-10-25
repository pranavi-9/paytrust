import { fundEscrow, getKey, parseId, errorResponse, okResponse } from '@/lib/ledger';
import { getActorId } from '@/lib/dev-auth';   // TODO: swap for Member B's session helper

// POST /api/escrow/:id/fund   Header: Idempotency-Key
export async function POST(request, { params }) {
  try {
    const actor = getActorId(request);
    const { id } = await params;
    return okResponse(await fundEscrow(actor, parseId(id), getKey(request)));
  } catch (e) { return errorResponse(e); }
}

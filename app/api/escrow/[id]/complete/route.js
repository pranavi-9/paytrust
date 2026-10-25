import { completeEscrow, parseId, errorResponse, okResponse } from '@/lib/ledger';
import { getActorId } from '@/lib/dev-auth';   // TODO: swap for Member B's session helper

// POST /api/escrow/:id/complete
export async function POST(request, { params }) {
  try {
    const actor = getActorId(request);
    const { id } = await params;
    return okResponse(await completeEscrow(actor, parseId(id)));
  } catch (e) { return errorResponse(e); }
}

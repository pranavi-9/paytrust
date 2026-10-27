import { completeEscrow, parseId, errorResponse, okResponse } from '@/lib/ledger';
import { getActorId } from '@/lib/auth';

// POST /api/escrow/:id/complete
export async function POST(request, { params }) {
  try {
    const actor = await getActorId();
    const { id } = await params;
    return okResponse(await completeEscrow(actor, parseId(id)));
  } catch (e) { return errorResponse(e); }
}

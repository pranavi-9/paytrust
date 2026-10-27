import { addFunds, getKey, parseAmount, errorResponse, okResponse } from '@/lib/ledger';
import { getActorId } from '@/lib/dev-auth';   // TODO: swap for Member B's session helper

// POST /api/wallet/add-funds   Header: Idempotency-Key   Body: { "amount": "500.00" }
export async function POST(request) {
  try {
    const actor = getActorId(request);
    const { amount } = await request.json();
    return okResponse(await addFunds(actor, actor, parseAmount(amount), getKey(request)));
  } catch (e) { return errorResponse(e); }
}

import { transfer, getKey, parseAmount, parseId, errorResponse, okResponse } from '@/lib/ledger';
import { getActorId } from '@/lib/dev-auth';   // TODO: swap for Member B's session helper

// POST /api/transfer   Header: Idempotency-Key
// Body: { "fromWalletId": 3, "toWalletId": 4, "amount": "500.00" }
export async function POST(request) {
  try {
    const actor = getActorId(request);
    const b = await request.json();
    return okResponse(await transfer(actor, parseId(b.fromWalletId), parseId(b.toWalletId),
                                     parseAmount(b.amount), getKey(request)));
  } catch (e) { return errorResponse(e); }
}

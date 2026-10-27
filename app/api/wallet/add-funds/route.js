import { addFunds, getKey, parseAmount, errorResponse, okResponse } from '@/lib/ledger';
import { getActorId } from '@/lib/auth';

// POST /api/wallet/add-funds   Header: Idempotency-Key   Body: { "amount": "500.00" }
export async function POST(request) {
  try {
    const actor = await getActorId();
    const { amount } = await request.json();
    return okResponse(await addFunds(actor, actor, parseAmount(amount), getKey(request)));
  } catch (e) { return errorResponse(e); }
}

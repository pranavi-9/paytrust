import { createEscrow, getKey, parseAmount, errorResponse, okResponse, LedgerError } from '@/lib/ledger';
import { getActorId } from '@/lib/auth';

// POST /api/escrow   Header: Idempotency-Key
// Body: { "seller_email": "diya@paytrust.test", "amount": "2500.00", "title": "Logo design", "description": "optional" }
// The buyer is the logged-in user. Creating an escrow moves no money; the buyer funds it next.
// 201 { escrowId, replayed: false }   (200 with replayed: true if the same request is repeated)
export async function POST(request) {
  try {
    const actor = await getActorId();
    let body;
    try { body = await request.json(); } catch { throw new LedgerError('INVALID_INPUT', 'send a JSON body', 400); }

    const { seller_email, amount, title, description } = body ?? {};
    if (typeof seller_email !== 'string' || seller_email.length > 150)
      throw new LedgerError('INVALID_INPUT', 'seller_email is required', 400);
    if (typeof title !== 'string' || title.trim().length < 3 || title.trim().length > 120)
      throw new LedgerError('INVALID_INPUT', 'title must be 3 to 120 characters', 400);
    if (description != null && (typeof description !== 'string' || description.length > 1000))
      throw new LedgerError('INVALID_INPUT', 'details must be at most 1000 characters', 400);

    return okResponse(await createEscrow(
      actor, seller_email, parseAmount(amount), title, description ?? null, getKey(request)));
  } catch (e) { return errorResponse(e); }
}

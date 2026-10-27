import { disputeEscrow, errorResponse, parseId, LedgerError } from '@/lib/ledger';
import { REASONS, ACTIVE, disputesCollection, requireSession, readJson, getEscrow } from '@/lib/disputes';
import { logActivity, clientIp } from '@/lib/activity';

export const runtime = 'nodejs';

// POST /api/disputes   { escrow_id, reason, description }
// The buyer or seller raises a dispute on a funded or completed escrow.
//
// Two databases are involved, so the order matters:
//   1. Save the case in MongoDB. Its unique index allows only one active
//      case per escrow, so a double-click can't create two.
//   2. CALL dispute_escrow (Member A) to freeze the escrow in MySQL.
//   3. If step 2 fails, delete the case from step 1, so we never leave a
//      case for an escrow that isn't actually disputed.
export async function POST(request) {
  try {
    const session = await requireSession();
    const body = await readJson(request);

    const escrowId = parseId(body.escrow_id);
    const reason = String(body.reason ?? '');
    const description = String(body.description ?? '').trim();
    if (!REASONS[reason]) throw new LedgerError('INVALID_INPUT', 'choose a reason', 400);
    if (description.length < 10) throw new LedgerError('INVALID_INPUT', 'describe the problem in at least 10 characters', 400);
    if (description.length > 2000) throw new LedgerError('INVALID_INPUT', 'keep the description under 2000 characters', 400);

    const escrow = await getEscrow(escrowId);
    const me = session.userId;
    if (!escrow || (escrow.buyer_id !== me && escrow.seller_id !== me)) {
      throw new LedgerError('NOT_FOUND', 'escrow not found', 404);
    }
    if (!['funded', 'completed', 'disputed'].includes(escrow.status)) {
      throw new LedgerError('INVALID_TRANSITION', `a ${escrow.status} escrow can’t be disputed`, 409);
    }

    const col = await disputesCollection();
    const now = new Date();
    let caseId;
    try {
      const res = await col.insertOne({
        escrow_id: escrowId,
        raised_by: me,
        against: me === escrow.buyer_id ? escrow.seller_id : escrow.buyer_id,
        reason,
        description,
        status: 'open',
        evidence: [],
        messages: [],
        created_at: now,
        updated_at: now,
      });
      caseId = res.insertedId;
    } catch (e) {
      if (e.code === 11000) {
        const existing = await col.findOne({ escrow_id: escrowId, status: { $in: ACTIVE } }, { projection: { _id: 1 } });
        return Response.json(
          { error: { code: 'ALREADY_DISPUTED', message: 'this escrow already has an open dispute' }, caseId: existing ? String(existing._id) : undefined },
          { status: 409 }
        );
      }
      throw e;
    }

    try {
      await disputeEscrow(me, escrowId);
    } catch (e) {
      await col.deleteOne({ _id: caseId }).catch((err) => console.error('could not undo dispute case', caseId, err));
      throw e;
    }

    await logActivity({ userId: me, action: 'dispute.raise', entityType: 'dispute', entityId: String(caseId), ip: clientIp(request), metadata: { escrow_id: escrowId, reason } });
    return Response.json({ caseId: String(caseId) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

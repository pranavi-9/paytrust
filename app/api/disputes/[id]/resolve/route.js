import { errorResponse, getKey, LedgerError } from '@/lib/ledger';
import { disputesCollection, requireSession, readJson, loadCase, resolveDisputeInDb } from '@/lib/disputes';
import { logActivity, clientIp } from '@/lib/activity';

export const runtime = 'nodejs';

// POST /api/disputes/:id/resolve   Header: Idempotency-Key
// Body: { decision: "release" | "refund", note }
//   release -> money goes to the seller, refund -> back to the buyer.
//
// Order: move the money first (MySQL, via resolve_dispute), then close the
// case in MongoDB. If closing the case fails, retrying with the same key is
// safe: the procedure replays the original transaction instead of paying twice.
export async function POST(request, { params }) {
  try {
    const session = await requireSession();
    if (session.role !== 'admin') throw new LedgerError('FORBIDDEN', 'only an admin can resolve a dispute', 403);
    const key = getKey(request);
    const { id } = await params;
    const c = await loadCase(session, id);

    const body = await readJson(request);
    const decision = String(body.decision ?? '');
    const note = String(body.note ?? '').trim();
    if (!['release', 'refund'].includes(decision)) throw new LedgerError('INVALID_INPUT', 'decision must be release or refund', 400);
    if (note.length < 5) throw new LedgerError('INVALID_INPUT', 'add a short note explaining the decision', 400);
    if (note.length > 2000) throw new LedgerError('INVALID_INPUT', 'keep the note under 2000 characters', 400);

    if (c.status === 'resolved') {
      if (c.resolution?.decision !== decision) {
        throw new LedgerError('INVALID_TRANSITION', `already resolved: ${c.resolution.decision}`, 409);
      }
      // Same decision again (a double-click or retry): report the original result.
      return Response.json({ caseId: id, decision, txnId: String(c.resolution.settle_txn_id), replayed: true }, { status: 200 });
    }

    const row = await resolveDisputeInDb(session.userId, c.escrow_id, decision, key);
    const txnId = Number(row.txn_id);

    const col = await disputesCollection();
    const now = new Date();
    await col.updateOne(
      { _id: c._id, status: { $ne: 'resolved' } },
      {
        $set: {
          status: 'resolved',
          updated_at: now,
          resolution: { decision, resolved_by: session.userId, resolved_at: now, note, settle_txn_id: txnId },
        },
      }
    );
    await logActivity({ userId: session.userId, action: 'dispute.resolve', entityType: 'dispute', entityId: id, ip: clientIp(request), metadata: { decision, escrow_id: c.escrow_id, txn_id: txnId } });

    const replayed = Boolean(Number(row.replayed));
    return Response.json({ caseId: id, decision, txnId: String(txnId), replayed }, { status: replayed ? 200 : 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

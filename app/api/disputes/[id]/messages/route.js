import { errorResponse, LedgerError } from '@/lib/ledger';
import { disputesCollection, requireSession, readJson, loadCase } from '@/lib/disputes';
import { logActivity, clientIp } from '@/lib/activity';

export const runtime = 'nodejs';

// POST /api/disputes/:id/messages   { body }
// Buyer, seller or admin adds a message. The admin's first message moves
// the case from "open" to "under_review".
export async function POST(request, { params }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const c = await loadCase(session, id);
    if (c.status === 'resolved') throw new LedgerError('INVALID_TRANSITION', 'this dispute is closed', 409);

    const { body } = await readJson(request);
    const text = String(body ?? '').trim();
    if (!text) throw new LedgerError('INVALID_INPUT', 'write a message', 400);
    if (text.length > 2000) throw new LedgerError('INVALID_INPUT', 'keep messages under 2000 characters', 400);

    const message = { sender_id: session.userId, body: text, sent_at: new Date() };
    const set = { updated_at: message.sent_at };
    if (session.role === 'admin' && c.status === 'open') set.status = 'under_review';

    const col = await disputesCollection();
    // Guard on status so a message can't land after the case was resolved.
    const res = await col.updateOne(
      { _id: c._id, status: { $ne: 'resolved' } },
      { $push: { messages: message }, $set: set }
    );
    if (res.matchedCount === 0) throw new LedgerError('INVALID_TRANSITION', 'this dispute is closed', 409);

    await logActivity({ userId: session.userId, action: 'dispute.message', entityType: 'dispute', entityId: id, ip: clientIp(request) });
    return Response.json({ message: { ...message, sent_at: message.sent_at.toISOString() } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

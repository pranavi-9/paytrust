import { errorResponse, LedgerError } from '@/lib/ledger';
import { requireSession, readJson } from '@/lib/disputes';
import { kycCollection, parseDocId, syncKycStatus } from '@/lib/kyc';
import { logActivity, clientIp } from '@/lib/activity';

export const runtime = 'nodejs';

// POST /api/admin/kyc/:id   { decision: "verify" | "reject", reason }
// Admin reviews a pending KYC document. MongoDB is updated first (only if
// the document is still pending), then users.kyc_status in MySQL is
// recomputed from MongoDB. Repeating the same decision is harmless.
export async function POST(request, { params }) {
  try {
    const session = await requireSession();
    if (session.role !== 'admin') throw new LedgerError('FORBIDDEN', 'admin only', 403);
    const { id } = await params;
    const _id = parseDocId(id);

    const body = await readJson(request);
    const decision = String(body.decision ?? '');
    const reason = String(body.reason ?? '').trim();
    if (!['verify', 'reject'].includes(decision)) throw new LedgerError('INVALID_INPUT', 'decision must be verify or reject', 400);
    if (decision === 'reject' && (reason.length < 5 || reason.length > 500)) {
      throw new LedgerError('INVALID_INPUT', 'give the user a reason (5 to 500 characters)', 400);
    }

    const col = await kycCollection();
    const target = decision === 'verify' ? 'verified' : 'rejected';
    const set = { status: target, reviewed_by: session.userId, reviewed_at: new Date() };
    const update = decision === 'reject' ? { $set: { ...set, rejection_reason: reason } } : { $set: set, $unset: { rejection_reason: '' } };

    const res = await col.findOneAndUpdate({ _id, status: 'pending' }, update, { returnDocument: 'after' });
    let doc = res;
    if (!doc) {
      doc = await col.findOne({ _id });
      if (!doc) throw new LedgerError('NOT_FOUND', 'document not found', 404);
      if (doc.status !== target) throw new LedgerError('INVALID_TRANSITION', `this document is already ${doc.status}`, 409);
      // Same decision repeated: fall through and re-sync MySQL.
    }

    const kycStatus = await syncKycStatus(doc.user_id);
    if (res) {
      await logActivity({ userId: session.userId, action: `kyc.${decision}`, entityType: 'kyc', entityId: id, ip: clientIp(request), metadata: { user_id: doc.user_id } });
    }
    return Response.json({ status: doc.status, kycStatus, replayed: !res }, { status: 200 });
  } catch (e) {
    return errorResponse(e);
  }
}

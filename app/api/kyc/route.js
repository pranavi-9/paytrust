import { errorResponse, LedgerError } from '@/lib/ledger';
import { requireSession, readJson } from '@/lib/disputes';
import { DOC_TYPES, maskNumber, kycCollection, syncKycStatus } from '@/lib/kyc';
import { logActivity, clientIp } from '@/lib/activity';

export const runtime = 'nodejs';

// POST /api/kyc   { doc_type, last4, file_url }
// A user submits an identity document for review. Only the last 4
// characters of the ID number are sent and stored (as a mask). One
// document per type; a rejected one can be submitted again.
export async function POST(request) {
  try {
    const session = await requireSession();
    if (session.role === 'admin') throw new LedgerError('FORBIDDEN', 'admins do not submit KYC', 403);

    const body = await readJson(request);
    const docType = String(body.doc_type ?? '');
    const last4 = String(body.last4 ?? '').trim().toUpperCase();
    const fileUrl = String(body.file_url ?? '').trim();

    if (!DOC_TYPES[docType]) throw new LedgerError('INVALID_INPUT', 'choose a document type', 400);
    if (!/^[0-9A-Z]{4}$/.test(last4)) throw new LedgerError('INVALID_INPUT', 'enter the last 4 letters or digits of the ID number', 400);
    let url;
    try { url = new URL(fileUrl); } catch { url = null; }
    if (!url || !['http:', 'https:'].includes(url.protocol) || fileUrl.length > 500) {
      throw new LedgerError('INVALID_INPUT', 'enter a full link to the document, starting with https://', 400);
    }

    const col = await kycCollection();
    const me = session.userId;
    const now = new Date();
    const doc = { user_id: me, doc_type: docType, number_masked: maskNumber(docType, last4), file_url: url.href, status: 'pending', submitted_at: now };

    // Insert, or replace a REJECTED document of the same type. The filter
    // never matches a pending or verified one, so those can't be overwritten:
    // the upsert then hits the unique (user_id, doc_type) index instead.
    try {
      await col.replaceOne({ user_id: me, doc_type: docType, status: 'rejected' }, doc, { upsert: true });
    } catch (e) {
      if (e.code === 11000) throw new LedgerError('INVALID_TRANSITION', `your ${DOC_TYPES[docType]} is already submitted`, 409);
      throw e;
    }

    const kycStatus = await syncKycStatus(me);
    await logActivity({ userId: me, action: 'kyc.submit', entityType: 'kyc', entityId: docType, ip: clientIp(request) });
    return Response.json({ status: 'pending', kycStatus }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

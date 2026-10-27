import { errorResponse, LedgerError } from '@/lib/ledger';
import { disputesCollection, requireSession, readJson, loadCase } from '@/lib/disputes';
import { logActivity, clientIp } from '@/lib/activity';

export const runtime = 'nodejs';

const MAX_EVIDENCE = 10;

// POST /api/disputes/:id/evidence   { file_url, caption }
// The buyer or seller attaches evidence as a link (a photo on Google Drive,
// a tracking page, a chat screenshot). Files aren't uploaded to our server.
export async function POST(request, { params }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const c = await loadCase(session, id);
    if (session.role === 'admin') throw new LedgerError('FORBIDDEN', 'only the buyer or seller can add evidence', 403);
    if (c.status === 'resolved') throw new LedgerError('INVALID_TRANSITION', 'this dispute is closed', 409);
    if ((c.evidence || []).length >= MAX_EVIDENCE) throw new LedgerError('INVALID_INPUT', `a case can hold at most ${MAX_EVIDENCE} pieces of evidence`, 400);

    const body = await readJson(request);
    const fileUrl = String(body.file_url ?? '').trim();
    const caption = String(body.caption ?? '').trim();

    let url;
    try {
      url = new URL(fileUrl);
    } catch {
      throw new LedgerError('INVALID_INPUT', 'enter a full link starting with https://', 400);
    }
    // Only web links: blocks javascript: and data: URLs, which would run code when clicked.
    if (!['http:', 'https:'].includes(url.protocol) || fileUrl.length > 500) {
      throw new LedgerError('INVALID_INPUT', 'enter a full link starting with https://', 400);
    }
    if (caption.length > 500) throw new LedgerError('INVALID_INPUT', 'keep the caption under 500 characters', 400);

    const item = { uploaded_by: session.userId, file_url: url.href, uploaded_at: new Date(), ...(caption ? { caption } : {}) };
    const col = await disputesCollection();
    const res = await col.updateOne(
      { _id: c._id, status: { $ne: 'resolved' }, [`evidence.${MAX_EVIDENCE - 1}`]: { $exists: false } },
      { $push: { evidence: item }, $set: { updated_at: item.uploaded_at } }
    );
    if (res.matchedCount === 0) throw new LedgerError('INVALID_TRANSITION', 'this dispute is closed or full', 409);

    await logActivity({ userId: session.userId, action: 'dispute.evidence', entityType: 'dispute', entityId: id, ip: clientIp(request) });
    return Response.json({ evidence: { ...item, uploaded_at: item.uploaded_at.toISOString() } }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

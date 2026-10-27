// Dispute helpers (Member B). Dispute cases live in MongoDB; the escrow and
// all money stay in MySQL. Errors use Member A's LedgerError so every API
// in the app answers with { error: { code, message } }.
import { ObjectId } from 'mongodb';
import { pool, query } from './mysql';
import { getDb, collections } from './mongo';
import { getSession } from './auth';
import { LedgerError } from './ledger';

export const REASONS = {
  not_delivered: 'Not delivered',
  not_as_described: 'Not as described',
  partial_delivery: 'Only partly delivered',
  quality_issue: 'Quality problem',
  other: 'Something else',
};

export const ACTIVE = ['open', 'under_review'];

export async function disputesCollection() {
  return (await getDb()).collection(collections.disputes);
}

/** Logged-in session or a 403 LedgerError. */
export async function requireSession() {
  const session = await getSession();
  if (!session) throw new LedgerError('FORBIDDEN', 'not signed in', 403);
  return session;
}

export function parseCaseId(id) {
  if (typeof id !== 'string' || !ObjectId.isValid(id) || String(new ObjectId(id)) !== id) {
    throw new LedgerError('NOT_FOUND', 'dispute not found', 404);
  }
  return new ObjectId(id);
}

/** Buyer and seller of the case, or the admin, may see it. */
export function canViewCase(session, c) {
  return session.role === 'admin' || c.raised_by === session.userId || c.against === session.userId;
}

/** Loads a case the session may see, or throws 404 (also for "not yours", so ids can't be probed). */
export async function loadCase(session, id) {
  const col = await disputesCollection();
  const c = await col.findOne({ _id: parseCaseId(id) });
  if (!c || !canViewCase(session, c)) throw new LedgerError('NOT_FOUND', 'dispute not found', 404);
  return c;
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new LedgerError('INVALID_INPUT', 'send a JSON body', 400);
  }
}

/** Escrow row with both parties' names, or null. */
export async function getEscrow(id) {
  const rows = await query(
    `SELECT e.id, e.title, e.description, e.amount, e.status, e.buyer_id, e.seller_id,
            e.created_at, e.funded_at, e.completed_at, e.settled_at,
            b.full_name AS buyer_name, s.full_name AS seller_name
       FROM escrows e
       JOIN users b ON b.id = e.buyer_id
       JOIN users s ON s.id = e.seller_id
      WHERE e.id = ?`,
    [id]
  );
  if (!rows[0]) return null;
  const e = rows[0];
  return { ...e, id: Number(e.id), buyer_id: Number(e.buyer_id), seller_id: Number(e.seller_id) };
}

// Turns "CODE: text" from SIGNAL 45000 into a LedgerError (same rule as lib/ledger.js).
const STATUS = {
  INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404,
  INVALID_TRANSITION: 409, IDEMPOTENCY_CONFLICT: 409, INSUFFICIENT_BALANCE: 422,
};
function translate(e) {
  const m = /^([A-Z_]+): (.*)$/s.exec(e.sqlMessage || '');
  if (e.sqlState === '45000' && m && STATUS[m[1]]) return new LedgerError(m[1], m[2], STATUS[m[1]]);
  return e;
}

/**
 * CALL resolve_dispute (db/disputes.sql) as the admin. Like A's money
 * procedures it manages its own transaction, so it runs on a plain pooled
 * connection with @app_user_id set, not inside withActor().
 * Returns { txn_id, replayed }.
 */
export async function resolveDisputeInDb(actorId, escrowId, decision, key) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET @app_user_id = ?', [actorId]);
    const [res] = await conn.query('CALL resolve_dispute(?, ?, ?)', [escrowId, decision, key]);
    return res[0][0];
  } catch (e) {
    throw translate(e);
  } finally {
    await conn.query('SET @app_user_id = NULL').catch(() => {});
    conn.release();
  }
}

/** Plain object safe to send as JSON or pass to a client component. */
export function serializeCase(c) {
  return {
    id: String(c._id),
    escrow_id: c.escrow_id,
    raised_by: c.raised_by,
    against: c.against,
    reason: c.reason,
    description: c.description ?? '',
    status: c.status,
    evidence: (c.evidence || []).map((e) => ({ ...e, uploaded_at: e.uploaded_at?.toISOString() })),
    messages: (c.messages || []).map((m) => ({ ...m, sent_at: m.sent_at?.toISOString() })),
    resolution: c.resolution ? { ...c.resolution, resolved_at: c.resolution.resolved_at?.toISOString() } : null,
    created_at: c.created_at?.toISOString(),
    updated_at: c.updated_at?.toISOString(),
  };
}

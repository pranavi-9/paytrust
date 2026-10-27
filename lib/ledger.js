// Thin wrappers over the money stored procedures (Member A).
// Uses the shared `pool` exported by lib/mysql.js (Member B).
import { pool } from './mysql';

const STATUS = {
  INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404,
  INVALID_TRANSITION: 409, IDEMPOTENCY_CONFLICT: 409, INSUFFICIENT_BALANCE: 422,
  LEDGER_IMMUTABLE: 500,
};

export class LedgerError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

// Turn a SIGNAL 45000 error ("CODE: text") into a LedgerError; anything else is a 500.
function translate(e) {
  const m = /^([A-Z_]+): (.*)$/s.exec(e.sqlMessage || '');
  if (e.sqlState === '45000' && m && STATUS[m[1]]) return new LedgerError(m[1], m[2], STATUS[m[1]]);
  return e;
}

// Money procedures manage their OWN transaction (and isolation level), so they must
// not run inside withActor(), which opens one first. We take a plain connection from
// the same pool, set @app_user_id, call the procedure, and always clear the variable.
async function callProc(actorId, sql, params) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET @app_user_id = ?', [actorId]);
    const [res] = await conn.query(sql, params);
    return res[0][0];                           // the single result row
  } catch (e) {
    throw translate(e);
  } finally {
    await conn.query('SET @app_user_id = NULL').catch(() => {});
    conn.release();
  }
}

export const addFunds = (actor, userId, amount, key) =>
  callProc(actor, 'CALL add_funds(?,?,?)', [userId, amount, key]);
export const transfer = (actor, fromWallet, toWallet, amount, key) =>
  callProc(actor, 'CALL process_transfer(?,?,?,?)', [fromWallet, toWallet, amount, key]);
export const fundEscrow = (actor, id, key) => callProc(actor, 'CALL fund_escrow(?,?)', [id, key]);
export const completeEscrow = (actor, id) => callProc(actor, 'CALL complete_escrow(?)', [id]);
export const releaseEscrow = (actor, id, key) => callProc(actor, 'CALL release_escrow(?,?)', [id, key]);
export const refundEscrow = (actor, id, key) => callProc(actor, 'CALL refund_escrow(?,?)', [id, key]);
export const disputeEscrow = (actor, id) => callProc(actor, 'CALL dispute_escrow(?)', [id]);

// ---- API helpers -------------------------------------------------------
// Amounts travel as STRINGS ("500.00") so JSON never rounds money.
export function parseAmount(v) {
  const s = typeof v === 'number' ? String(v) : v;
  if (typeof s !== 'string' || !/^\d{1,13}(\.\d{1,2})?$/.test(s) || Number(s) <= 0)
    throw new LedgerError('INVALID_INPUT', 'amount must be a positive number with at most 2 decimals', 400);
  return Number(s).toFixed(2);
}
export function getKey(request) {
  const k = request.headers.get('idempotency-key');
  if (!k || k.length > 64) throw new LedgerError('INVALID_INPUT', 'Idempotency-Key header (max 64 chars) is required', 400);
  return k;
}
export function parseId(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new LedgerError('INVALID_INPUT', 'invalid id', 400);
  return n;
}
export function errorResponse(e) {
  if (e instanceof LedgerError) return Response.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  console.error(e);
  return Response.json({ error: { code: 'INTERNAL', message: 'Something went wrong' } }, { status: 500 });
}
export const okResponse = (row) =>
  Response.json({ txnId: row.txn_id ? String(row.txn_id) : undefined, escrowId: row.escrow_id ? String(row.escrow_id) : undefined,
                  status: row.status, replayed: Boolean(Number(row.replayed)) }, { status: Number(row.replayed) ? 200 : 201 });

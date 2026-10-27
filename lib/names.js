import { query } from './mysql';

/** { id: full_name } for a list of user ids (one parameterized query). */
export async function userNames(ids) {
  const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (unique.length === 0) return {};
  const rows = await query(
    `SELECT id, full_name FROM users WHERE id IN (${unique.map(() => '?').join(',')})`,
    unique
  );
  return Object.fromEntries(rows.map((r) => [Number(r.id), r.full_name]));
}

/** { id: title } for a list of escrow ids. */
export async function escrowTitles(ids) {
  const unique = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
  if (unique.length === 0) return {};
  const rows = await query(
    `SELECT id, title, amount, status FROM escrows WHERE id IN (${unique.map(() => '?').join(',')})`,
    unique
  );
  return Object.fromEntries(rows.map((r) => [Number(r.id), r]));
}

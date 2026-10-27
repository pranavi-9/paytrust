// Admin analytics (Member B). Money figures come from MySQL (the ledger is
// the source of truth); dispute and activity figures come from MongoDB.
import { query } from './mysql';
import { getDb, collections } from './mongo';
import { getDisputeAnalytics } from './disputeAnalytics';

export const RANGES = {
  '7d': { label: 'Last 7 days', days: 7 },
  '30d': { label: 'Last 30 days', days: 30 },
  all: { label: 'All time', days: null },
};

const TYPE_LABELS = {
  topup: 'Money added',
  transfer: 'Transfers',
  escrow_fund: 'Escrow funding',
  escrow_release: 'Escrow releases',
  escrow_refund: 'Escrow refunds',
};

export async function getMoneyAnalytics(range) {
  const days = RANGES[range]?.days ?? null;
  // The cut-off is a bound parameter; NULL means "all time".
  const since = days ? new Date(Date.now() - days * 86_400_000) : null;
  const sinceClause = '(? IS NULL OR t.created_at >= ?)';

  const [[kpi], byType, perDay, topSenders, [escrowRate]] = await Promise.all([
    // Headline numbers (all time).
    query(
      `SELECT (SELECT COUNT(*) FROM users WHERE role = 'user') AS users,
              (SELECT COUNT(*) FROM users WHERE role = 'user' AND kyc_status = 'verified') AS verified_users,
              (SELECT COUNT(*) FROM users WHERE role = 'user' AND is_active = FALSE) AS frozen_users,
              (SELECT balance FROM wallets WHERE wallet_type = 'escrow' LIMIT 1) AS held_in_escrow,
              (SELECT COALESCE(SUM(balance), 0) FROM wallets WHERE wallet_type = 'user') AS user_balances`
    ),
    // Money moved, grouped by transaction type.
    query(
      `SELECT t.type, COUNT(*) AS n, SUM(t.amount) AS total
         FROM transactions t
        WHERE ${sinceClause}
        GROUP BY t.type
        ORDER BY total DESC`,
      [since, since]
    ),
    // Money moved per day (user-to-user transfers and escrow funding only:
    // top-ups are simulated deposits, not activity between users).
    query(
      `SELECT DATE(t.created_at) AS day, COUNT(*) AS n, SUM(t.amount) AS total
         FROM transactions t
        WHERE t.type IN ('transfer', 'escrow_fund') AND ${sinceClause}
        GROUP BY DATE(t.created_at)
        ORDER BY day`,
      [since, since]
    ),
    // Top senders: CTE for the totals, window function for the rank (ties share a rank).
    query(
      `WITH sent AS (
         SELECT w.user_id, COUNT(*) AS n, SUM(t.amount) AS total
           FROM transactions t
           JOIN wallets w ON w.id = t.from_wallet_id AND w.wallet_type = 'user'
          WHERE t.type IN ('transfer', 'escrow_fund') AND ${sinceClause}
          GROUP BY w.user_id
       )
       SELECT u.id, u.full_name, s.n, s.total, RANK() OVER (ORDER BY s.total DESC) AS rnk
         FROM sent s JOIN users u ON u.id = s.user_id
        ORDER BY rnk, u.full_name
        LIMIT 5`,
      [since, since]
    ),
    // How escrows end: released to the seller vs refunded to the buyer.
    query(
      `SELECT SUM(status = 'released') AS released, SUM(status = 'refunded') AS refunded,
              SUM(status IN ('funded', 'completed', 'disputed')) AS in_progress
         FROM escrows`
    ),
  ]);

  return {
    kpi,
    byType: byType.map((r) => ({ ...r, label: TYPE_LABELS[r.type] ?? r.type })),
    perDay: fillDays(perDay, days ?? 14),
    topSenders,
    escrowRate,
  };
}

// One entry per day for the last `days` days, with 0 where nothing happened,
// so the chart's x-axis is continuous. Capped at 31 columns.
function fillDays(rows, days) {
  const n = Math.min(days, 31);
  const byDay = new Map(rows.map((r) => [toKey(new Date(r.day)), r]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const key = toKey(d);
    const r = byDay.get(key);
    out.push({ key, label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), total: r ? String(r.total) : '0.00', n: r ? Number(r.n) : 0 });
  }
  return out;
}
const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export async function getDisputeAndActivityAnalytics(range) {
  const days = RANGES[range]?.days ?? null;
  const from = days ? new Date(Date.now() - days * 86_400_000) : undefined;
  const db = await getDb();

  const [disputes, activity, recent] = await Promise.all([
    getDisputeAnalytics(db, { from }),
    // Activity by action (MongoDB aggregation).
    db.collection(collections.activity).aggregate([
      { $match: from ? { created_at: { $gte: from } } : {} },
      { $group: { _id: '$action', count: { $sum: 1 }, users: { $addToSet: '$user_id' } } },
      { $project: { count: 1, users: { $size: '$users' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]).toArray(),
    db.collection(collections.activity).find({}, { projection: { user_id: 1, action: 1, created_at: 1 } }).sort({ created_at: -1 }).limit(10).toArray(),
  ]);
  return { disputes, activity, recent };
}

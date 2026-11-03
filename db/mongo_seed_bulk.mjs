// =====================================================================
// PayTrust: bulk demo data for MongoDB (Member A, for the shared demo)
//   node --env-file=.env db/mongo_seed_bulk.mjs            add the data
//   node --env-file=.env db/mongo_seed_bulk.mjs --reset    remove it again, then add it
//
// Run AFTER: seed.sql, seed_part2.sql, seed_bulk.sql, `npm run db:mongo`
// and `npm run db:mongo-seed`.
//
// What it adds (everything is built from the real MySQL rows, so ids match):
//   kyc_documents  one document per demo user, status taken from users.kyc_status
//   dispute_cases  one case for every escrow that went through a dispute
//   activity_logs  ~200 entries: registrations, logins, failed logins, KYC, escrows,
//                  money movements (taken from the transactions table), disputes
// MongoDB never holds balances or ledger rows; only ids that point at MySQL.
// Safe to run twice: it skips anything already there (activity logs are tagged
// metadata.seed = 'bulk', which is also what --reset removes).
// =====================================================================
import { MongoClient } from 'mongodb';
import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';

const DAY = 86_400_000;
const ADMIN_ID = 101;

// Small deterministic pseudo-random numbers so every run produces the same demo data.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const DOC_TYPES = ['aadhaar', 'pan', 'passport', 'driving_licence', 'voter_id'];
function maskedNumber(type, rand) {
  const d = (n) => String(Math.floor(rand() * 10 ** n)).padStart(n, '0');
  switch (type) {
    case 'aadhaar': return `XXXX-XXXX-${d(4)}`;
    case 'pan': return `XXXXXX${d(3)}${String.fromCharCode(65 + Math.floor(rand() * 26))}`;
    case 'driving_licence': return `XXXX-XXXX-${d(4)}`;
    default: return `XXXXXXX${d(3)}`;
  }
}

const CASE_TEXT = [
  { reason: 'not_delivered', description: 'The work was due last week and nothing has been delivered.',
    raiser: 'I paid into escrow and have not received anything yet.', other: 'I sent the files twice, they are in the shared folder.' },
  { reason: 'not_as_described', description: 'What arrived is different from what we agreed in the title.',
    raiser: 'The result does not match the description we agreed on.', other: 'I delivered exactly what the title says, nothing more was asked.' },
  { reason: 'quality_issue', description: 'The delivered work has problems and needs to be redone.',
    raiser: 'There are several mistakes. I asked for a fix and got no reply.', other: 'I made two rounds of corrections, I think it is fine now.' },
  { reason: 'partial_delivery', description: 'Only part of the agreed work was delivered.',
    raiser: 'Only about half of the agreed items were delivered.', other: 'The rest was blocked until I got the missing details.' },
];

/** Builds every document from MySQL. Pure function of the rows, easy to test. */
export function buildDocs({ users, disputed, txns, escrows, now = Date.now() }) {
  const rand = rng(2026);
  const at = (msAgo) => new Date(now - msAgo);

  // ---- KYC: one document per user, status copied from MySQL ----
  const kyc = [];
  const kycLogs = [];
  users.filter((u) => u.role === 'user').forEach((u, i) => {
    const type = DOC_TYPES[i % DOC_TYPES.length];
    const submitted = at((20 - (i % 12)) * DAY + i * 3_600_000);
    const doc = {
      user_id: u.id, doc_type: type, number_masked: maskedNumber(type, rand),
      file_url: `https://example.com/kyc/user-${u.id}-${type}.pdf`,
      status: u.kyc_status, submitted_at: submitted,
    };
    if (u.kyc_status !== 'pending') {
      doc.reviewed_by = ADMIN_ID;
      doc.reviewed_at = new Date(submitted.getTime() + DAY * (1 + (i % 3)));
    }
    if (u.kyc_status === 'rejected') doc.rejection_reason = 'The photo is blurry. Please upload a clear scan of the full document.';
    kyc.push(doc);
    kycLogs.push({ user_id: u.id, action: 'kyc.submit', entity_type: 'kyc', entity_id: u.id, created_at: submitted, metadata: { doc_type: type } });
    if (u.kyc_status !== 'pending') kycLogs.push({ user_id: ADMIN_ID, action: `kyc.${u.kyc_status === 'verified' ? 'approve' : 'reject'}`, entity_type: 'kyc', entity_id: u.id, created_at: doc.reviewed_at, metadata: { target_user: u.id } });
  });

  // ---- Dispute cases: one per escrow that was disputed ----
  const cases = [];
  const disputeLogs = [];
  disputed.forEach((e, i) => {
    const txt = CASE_TEXT[i % CASE_TEXT.length];
    const raiser = e.raised_by, other = raiser === e.buyer_id ? e.seller_id : e.buyer_id;
    const created = at((8 + i * 2) * DAY);
    const t = (h) => new Date(created.getTime() + h * 3_600_000);
    const c = {
      escrow_id: e.id, raised_by: raiser, against: other,
      reason: txt.reason, description: `${txt.description} (${e.title})`,
      status: 'open',
      evidence: [{ uploaded_by: raiser, file_url: `https://example.com/evidence/escrow-${e.id}-1.png`, caption: 'Screenshot of our chat', uploaded_at: t(1) }],
      messages: [
        { sender_id: raiser, body: txt.raiser, sent_at: t(2) },
        { sender_id: other, body: txt.other, sent_at: t(6) },
      ],
      created_at: created, updated_at: t(6),
    };
    disputeLogs.push({ user_id: raiser, action: 'dispute.raise', entity_type: 'dispute', entity_id: e.id, created_at: created, metadata: { reason: txt.reason } });
    disputeLogs.push({ user_id: other, action: 'dispute.message', entity_type: 'dispute', entity_id: e.id, created_at: t(6) });
    if (e.status === 'released' || e.status === 'refunded') {
      const decision = e.status === 'released' ? 'release' : 'refund';
      const resolved = t(30);
      c.status = 'resolved';
      c.resolution = {
        decision, resolved_by: ADMIN_ID, resolved_at: resolved,
        note: decision === 'release' ? 'The seller showed the work was delivered. Money released to the seller.' : 'The buyer showed the work was not delivered as agreed. Money refunded to the buyer.',
        ...(e.settle_txn_id ? { settle_txn_id: e.settle_txn_id } : {}),
      };
      c.updated_at = resolved;
      disputeLogs.push({ user_id: ADMIN_ID, action: 'dispute.resolve', entity_type: 'dispute', entity_id: e.id, created_at: resolved, metadata: { decision } });
    }
    cases.push(c);
  });

  // ---- Activity logs ----
  const logs = [];
  const span = 14 * DAY;
  const start = now - span;
  users.filter((u) => u.role === 'user').forEach((u, i) => {
    const reg = new Date(start - (i + 1) * 3_600_000);
    logs.push({ user_id: u.id, action: 'user.register', entity_type: 'user', entity_id: u.id, created_at: reg });
    const logins = 1 + Math.floor(rand() * 3);
    for (let k = 0; k < logins; k++) {
      const when = new Date(start + rand() * span);
      logs.push({ user_id: u.id, action: 'login.success', entity_type: 'user', entity_id: u.id, ip: `203.0.113.${10 + ((u.id * 7 + k) % 200)}`, created_at: when });
      if (rand() < 0.35) logs.push({ user_id: u.id, action: 'logout', entity_type: 'user', entity_id: u.id, created_at: new Date(when.getTime() + 20 * 60_000) });
    }
  });
  for (let k = 0; k < 8; k++) {
    const u = users[Math.floor(rand() * users.length)];
    logs.push({ user_id: null, action: 'login.failed', entity_type: null, entity_id: null, ip: `198.51.100.${20 + k * 9}`, created_at: new Date(start + rand() * span), metadata: { email: u.email } });
  }
  const ACTION = { topup: 'wallet.add_funds', transfer: 'transfer.create', escrow_fund: 'escrow.fund', escrow_release: 'escrow.release', escrow_refund: 'escrow.refund' };
  txns.forEach((t, i) => {
    if (!t.initiated_by) return;
    logs.push({
      user_id: t.initiated_by, action: ACTION[t.type], entity_type: 'transaction', entity_id: t.id,
      created_at: new Date(start + ((i + 1) / (txns.length + 1)) * span),
      metadata: { amount: String(t.amount) },
    });
  });
  escrows.forEach((e, i) => {
    logs.push({
      user_id: e.buyer_id, action: 'escrow.create', entity_type: 'escrow', entity_id: e.id,
      created_at: new Date(start + ((i + 0.5) / (escrows.length + 1)) * span), metadata: { title: e.title },
    });
  });
  logs.push(...kycLogs, ...disputeLogs);
  const tagged = logs.map((l) => ({ ...l, metadata: { ...(l.metadata ?? {}), seed: 'bulk' } }));
  tagged.sort((a, b) => a.created_at - b.created_at);
  return { kyc, cases, logs: tagged };
}

export async function seed(db, conn, { reset = false } = {}) {
  const [users] = await conn.query("SELECT id, full_name, email, role, kyc_status FROM users ORDER BY id");
  const [escrows] = await conn.query('SELECT id, buyer_id, seller_id, title, status, settle_txn_id FROM escrows ORDER BY id');
  const [txns] = await conn.query('SELECT id, type, amount, initiated_by FROM transactions ORDER BY id');
  const disputed = [];
  for (const e of escrows) {
    const [[d]] = await conn.query(
      "SELECT changed_by FROM escrow_status_audit WHERE escrow_id = ? AND new_status = 'disputed' ORDER BY id LIMIT 1", [e.id]);
    if (d) disputed.push({ ...e, raised_by: Number(d.changed_by), id: Number(e.id), buyer_id: Number(e.buyer_id), seller_id: Number(e.seller_id), settle_txn_id: e.settle_txn_id != null ? Number(e.settle_txn_id) : null });
  }
  const norm = (rows) => rows.map((r) => ({ ...r, id: Number(r.id), buyer_id: r.buyer_id != null ? Number(r.buyer_id) : r.buyer_id, initiated_by: r.initiated_by != null ? Number(r.initiated_by) : r.initiated_by }));
  const { kyc, cases, logs } = buildDocs({
    users: users.map((u) => ({ ...u, id: Number(u.id) })), disputed,
    txns: norm(txns), escrows: norm(escrows),
  });

  if (reset) {
    const r = await db.collection('activity_logs').deleteMany({ 'metadata.seed': 'bulk' });
    console.log(`reset: removed ${r.deletedCount} bulk activity logs`);
  }

  // KYC: upsert, so a real submission made in the app is never overwritten.
  let kycAdded = 0;
  for (const d of kyc) {
    const r = await db.collection('kyc_documents').updateOne({ user_id: d.user_id, doc_type: d.doc_type }, { $setOnInsert: d }, { upsert: true });
    if (r.upsertedCount) kycAdded++;
  }
  console.log(`kyc_documents: added ${kycAdded}, skipped ${kyc.length - kycAdded} that already existed`);

  // Disputes: skip any escrow that already has a case.
  let casesAdded = 0;
  for (const c of cases) {
    if (await db.collection('dispute_cases').findOne({ escrow_id: c.escrow_id })) continue;
    await db.collection('dispute_cases').insertOne(c);
    casesAdded++;
  }
  console.log(`dispute_cases: added ${casesAdded}, skipped ${cases.length - casesAdded} that already existed`);

  if (await db.collection('activity_logs').countDocuments({ 'metadata.seed': 'bulk' })) {
    console.log('activity_logs: bulk data already there (use --reset to rebuild it)');
  } else {
    await db.collection('activity_logs').insertMany(logs);
    console.log(`activity_logs: added ${logs.length}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.MONGODB_URI) { console.error('Missing MONGODB_URI. Run with: node --env-file=.env db/mongo_seed_bulk.mjs'); process.exit(1); }
  const mongo = new MongoClient(process.env.MONGODB_URI);
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST, port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD ?? '', database: process.env.MYSQL_DATABASE,
    });
    await mongo.connect();
    await seed(mongo.db(process.env.MONGODB_DB || 'paytrust'), conn, { reset: process.argv.includes('--reset') });
  } catch (err) {
    console.error('Mongo bulk seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await conn?.end();
    await mongo.close();
  }
}

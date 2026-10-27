// =====================================================================
// PayTrust: demo dispute case (Member B)
//   npm run db:mongo-seed
// Run after seed_part2.sql and npm run db:mongo. seed_part2.sql disputes
// escrow 3 in MySQL (Meera, the seller, disputed it); this adds the
// matching case in MongoDB so the admin queue has something to resolve.
// Safe to run again: it only adds the case if escrow 3 is disputed and
// has no active case yet.
// =====================================================================
import { MongoClient } from 'mongodb';
import mysql from 'mysql2/promise';
import { pathToFileURL } from 'node:url';

const ESCROW_ID = 3;

export async function seed(db, conn) {
  const [[escrow]] = await conn.query('SELECT status, buyer_id, seller_id FROM escrows WHERE id = ?', [ESCROW_ID]);
  if (!escrow || escrow.status !== 'disputed') {
    console.log(`skipped: escrow ${ESCROW_ID} is ${escrow ? escrow.status : 'missing'}, not disputed`);
    return;
  }
  const col = db.collection('dispute_cases');
  const existing = await col.findOne({ escrow_id: ESCROW_ID, status: { $in: ['open', 'under_review'] } });
  if (existing) {
    console.log(`skipped: escrow ${ESCROW_ID} already has case ${existing._id}`);
    return;
  }

  const seller = Number(escrow.seller_id);
  const buyer = Number(escrow.buyer_id);
  const t = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000);

  const res = await col.insertOne({
    escrow_id: ESCROW_ID,
    raised_by: seller,
    against: buyer,
    reason: 'other',
    description: 'I taught all four tutoring sessions, but the buyer says only two happened and won’t confirm completion.',
    status: 'open',
    evidence: [
      { uploaded_by: seller, file_url: 'https://example.com/tutoring-attendance-sheet', caption: 'Attendance sheet signed after each session', uploaded_at: t(50) },
    ],
    messages: [
      { sender_id: seller, body: 'All four sessions happened on the dates we agreed. I’ve attached the attendance sheet.', sent_at: t(45) },
      { sender_id: buyer, body: 'Sessions 3 and 4 were cancelled by the tutor and never rescheduled.', sent_at: t(30) },
    ],
    created_at: t(60),
    updated_at: t(30),
  });
  console.log(`created dispute case ${res.insertedId} for escrow ${ESCROW_ID}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mongo = new MongoClient(process.env.MONGODB_URI);
  let conn;
  try {
    conn = await mysql.createConnection({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD ?? '',
      database: process.env.MYSQL_DATABASE,
    });
    await mongo.connect();
    await seed(mongo.db(process.env.MONGODB_DB || 'paytrust'), conn);
  } catch (err) {
    console.error('Mongo seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await conn?.end();
    await mongo.close();
  }
}

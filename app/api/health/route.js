import { query } from '@/lib/mysql';
import { getDb } from '@/lib/mongo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Connection test: GET /api/health reports whether MySQL and MongoDB are reachable.
export async function GET() {
  const result = { mysql: { ok: false }, mongo: { ok: false } };

  try {
    const rows = await query('SELECT VERSION() AS version, DATABASE() AS db');
    const tables = await query(
      'SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name'
    );
    result.mysql = { ok: true, version: rows[0].version, database: rows[0].db, tables: tables.map((t) => t.name) };
  } catch (err) {
    result.mysql = { ok: false, error: err.message };
  }

  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    const cols = await db.listCollections({}, { nameOnly: true }).toArray();
    result.mongo = { ok: true, database: db.databaseName, collections: cols.map((c) => c.name).sort() };
  } catch (err) {
    result.mongo = { ok: false, error: err.message };
  }

  const ok = result.mysql.ok && result.mongo.ok;
  return Response.json({ ok, ...result }, { status: ok ? 200 : 503 });
}

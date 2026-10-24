import mysql from 'mysql2/promise';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. Copy .env.example to .env.`);
  return value;
}

function createPool() {
  return mysql.createPool({
    host: required('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: required('MYSQL_USER'),
    password: process.env.MYSQL_PASSWORD ?? '',
    database: required('MYSQL_DATABASE'),
    connectionLimit: 10,
    waitForConnections: true,
    // DECIMAL columns come back as strings so money never passes through a JS float.
    decimalNumbers: false,
    timezone: 'Z',
    dateStrings: false,
    multipleStatements: false,
  });
}

// Reuse one pool across Next.js hot reloads in development.
const globalForMysql = globalThis;
export const pool = globalForMysql.__paytrustMysqlPool ?? createPool();
if (process.env.NODE_ENV !== 'production') globalForMysql.__paytrustMysqlPool = pool;

/** Run a parameterized query. Always pass values through `params`, never build SQL strings. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

/**
 * Run work on one connection with @app_user_id set, so the escrow audit trigger
 * can record who made the change. Wraps the work in a transaction.
 *
 *   await withActor(userId, (conn) => conn.execute('CALL release_escrow(?, ?)', [escrowId, key]));
 */
export async function withActor(userId, work) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET @app_user_id = ?', [userId]);
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    // Clear the variable before the connection goes back to the pool.
    await conn.query('SET @app_user_id = NULL').catch(() => {});
    conn.release();
  }
}

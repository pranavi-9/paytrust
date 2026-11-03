// PayTrust stress test (Member A).  Run against a SEPARATE test database
// (the ledger is append-only, so test rows can never be deleted):
//
//   mysql -u root -p -e "CREATE DATABASE paytrust_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
//   (load schema.sql, schema_escrow.sql, procedures.sql, disputes.sql, triggers.sql into it)
//   Windows cmd:   set DB_NAME=paytrust_test
//                  node --env-file=.env scripts/stress_test.mjs
//   Mac/Linux:     DB_NAME=paytrust_test node --env-file=.env scripts/stress_test.mjs
//
// Connection settings come from DB_* variables if set, otherwise from the
// MYSQL_* variables in .env. The test refuses to run against the real
// `paytrust` database unless you pass --allow-main-db.
// Proves: no lost updates, no deadlocks, idempotency under races, no overdraft,
// ledger always reconciles, SUM(all balances) = 0.
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

const env = process.env;
const cfg = {
  host: env.DB_HOST || env.MYSQL_HOST || '127.0.0.1',
  port: Number(env.DB_PORT || env.MYSQL_PORT || 3306),
  user: env.DB_USER || env.MYSQL_USER || 'root',
  password: env.DB_PASSWORD ?? env.MYSQL_PASSWORD ?? '',
  database: env.DB_NAME || env.MYSQL_DATABASE || 'paytrust',
  socketPath: env.DB_SOCKET || undefined,
};
if (cfg.database === 'paytrust' && !process.argv.includes('--allow-main-db')) {
  console.error('Refusing to run against the real "paytrust" database (it would add test users and money).');
  console.error('Use a test database:  set DB_NAME=paytrust_test   (see the top of this file).');
  process.exit(2);
}
const pool = mysql.createPool({ ...cfg, connectionLimit: 40 });
let failed = 0;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`);
  if (!ok) failed++;
};

// Run one procedure call as a user on its own connection.
async function call(actor, sql, params) {
  const c = await pool.getConnection();
  try {
    await c.query('SET @app_user_id = ?', [actor]);
    const [res] = await c.query(sql, params);
    return { ok: true, row: res[0][0] };
  } catch (e) {
    return { ok: false, msg: e.sqlMessage || e.message, errno: e.errno };
  } finally {
    await c.query('SET @app_user_id = NULL').catch(() => {});
    c.release();
  }
}

const run = crypto.randomBytes(4).toString('hex');
const tag = (s) => `st-${run}-${s}`;

// Fresh users + wallets for this run (so reruns don't interfere)
const users = [];
for (let i = 0; i < 4; i++) {
  const [r] = await pool.query(
    "INSERT INTO users (full_name,email,password_hash) VALUES (?,?,'x')",
    [`Stress ${i}`, `stress-${run}-${i}@paytrust.test`]);
  const [w] = await pool.query('INSERT INTO wallets (user_id) VALUES (?)', [r.insertId]);
  users.push({ id: r.insertId, wallet: w.insertId });
}
const [A, B, C, D] = users;

// 1. Fund A, B
await call(A.id, 'CALL add_funds(?,?,?)', [A.id, '10000.00', tag('fundA')]);
await call(B.id, 'CALL add_funds(?,?,?)', [B.id, '10000.00', tag('fundB')]);

// 2. 200 concurrent transfers A<->B in both directions (deadlock bait)
const t0 = Date.now();
const jobs = [];
for (let i = 0; i < 100; i++) {
  jobs.push(call(A.id, 'CALL process_transfer(?,?,?,?)', [A.wallet, B.wallet, '10.00', tag(`ab${i}`)]));
  jobs.push(call(B.id, 'CALL process_transfer(?,?,?,?)', [B.wallet, A.wallet, '5.00', tag(`ba${i}`)]));
}
const r2 = await Promise.all(jobs);
const okCount = r2.filter((r) => r.ok).length;
check('200 opposite-direction transfers all succeed (no deadlock)', okCount === 200,
  `(${okCount}/200 in ${Date.now() - t0}ms; errors: ${[...new Set(r2.filter((r) => !r.ok).map((r) => r.msg))].join('|')})`);
const bal = async (u) => (await pool.query('SELECT balance FROM wallets WHERE id=?', [u.wallet]))[0][0].balance;
check('balances exact after race', (await bal(A)) === '9500.00' && (await bal(B)) === '10500.00',
  `(A=${await bal(A)}, B=${await bal(B)})`);

// 3. Same idempotency key fired 50x at once -> exactly one real transfer
const same = await Promise.all(Array.from({ length: 50 }, () =>
  call(A.id, 'CALL process_transfer(?,?,?,?)', [A.wallet, C.wallet, '100.00', tag('dup')])));
const ids = new Set(same.filter((r) => r.ok).map((r) => r.row.txn_id));
const fresh = same.filter((r) => r.ok && Number(r.row.replayed) === 0).length;
check('50 parallel requests, same key -> 1 transaction, 1 non-replay', ids.size === 1 && fresh === 1 && same.every((r) => r.ok),
  `(distinct txns=${ids.size}, non-replayed=${fresh})`);
check('receiver credited exactly once', (await bal(C)) === '100.00', `(C=${await bal(C)})`);

// 4. Overdraft race: C has 100, 30 requests of 10 each from different keys -> exactly 10 succeed
const od = await Promise.all(Array.from({ length: 30 }, (_, i) =>
  call(C.id, 'CALL process_transfer(?,?,?,?)', [C.wallet, D.wallet, '10.00', tag(`od${i}`)])));
const odOk = od.filter((r) => r.ok).length;
check('overdraft race: exactly 10 of 30 succeed', odOk === 10 && (await bal(C)) === '0.00' && (await bal(D)) === '100.00',
  `(ok=${odOk}, C=${await bal(C)}, D=${await bal(D)})`);
check('rejections are INSUFFICIENT_BALANCE', od.filter((r) => !r.ok).every((r) => /^INSUFFICIENT_BALANCE/.test(r.msg)));

// 5. Escrow double-release race: 20 parallel releases by buyer with different keys -> one wins
const [e] = await pool.query('INSERT INTO escrows (buyer_id,seller_id,amount,title) VALUES (?,?,?,?)', [A.id, B.id, '250.00', 'stress']);
await call(A.id, 'CALL fund_escrow(?,?)', [e.insertId, tag('ef')]);
await call(B.id, 'CALL complete_escrow(?)', [e.insertId]);
const rel = await Promise.all(Array.from({ length: 20 }, (_, i) => call(A.id, 'CALL release_escrow(?,?)', [e.insertId, tag(`rel${i}`)])));
check('escrow released exactly once under 20 racing requests', rel.filter((r) => r.ok).length === 1,
  `(ok=${rel.filter((r) => r.ok).length})`);
check('losers get INVALID_TRANSITION', rel.filter((r) => !r.ok).every((r) => /^INVALID_TRANSITION/.test(r.msg)));

// 6. Global invariants
const [[sum]] = await pool.query('SELECT SUM(balance) s FROM wallets');
const [[bad]] = await pool.query('SELECT COUNT(*) n FROM wallet_balance_summary WHERE difference <> 0');
const [[unb]] = await pool.query(`SELECT COUNT(*) n FROM (SELECT transaction_id FROM ledger_entries GROUP BY transaction_id
  HAVING SUM(entry_type='debit')<>1 OR SUM(entry_type='credit')<>1 OR SUM(IF(entry_type='debit',amount,-amount))<>0) x`);
check('SUM of all wallet balances = 0', Number(sum.s) === 0, `(${sum.s})`);
check('every wallet: cached balance = ledger-derived', bad.n === 0, `(mismatches=${bad.n})`);
check('every transaction: exactly 1 debit + 1 credit, equal amounts', unb.n === 0, `(unbalanced=${unb.n})`);

await pool.end();
console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failed ? 1 : 0);

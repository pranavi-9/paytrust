# PayTrust

Escrow-backed payments app for a two-person DBMS course project. Users hold wallets, send money, and fund escrows that are released, refunded or disputed. An admin resolves disputes.

## Stack

- **Frontend and API:** Next.js (App Router, API routes under `app/api/`)
- **Relational DB:** MySQL. Holds all money data (users, wallets, transactions, ledger, escrows).
- **Document DB:** MongoDB. Holds dispute cases, KYC documents and activity logs only. Never store balances or money movements here.
- **Auth:** bcrypt password hashing, JWT sessions, role middleware (`user`, `admin`)

## Commands

```bash
npm install
npm run dev                                          # start Next.js on localhost:3000
mysql -u root -p paytrust < db/schema.sql            # A: users, wallets, transactions, ledger
mysql -u root -p paytrust < db/schema_escrow.sql     # B: escrows, escrow_status_audit
mysql -u root -p paytrust < db/procedures.sql        # A: stored procedures
mysql -u root -p paytrust < db/triggers.sql          # B: escrow audit trigger
mysql -u root -p paytrust < db/seed.sql              # B: demo data
npm run db:mongo                                     # Mongo collections, validators, indexes
npm run db:analytics                                 # print dispute analytics
node scripts/stress_test.js                          # A: concurrency stress test
```

(Update these paths if the repo layout changes.)

## Data model

MySQL tables: `users`, `wallets`, `transactions`, `ledger_entries`, `escrows`, `escrow_status_audit`
- View: `wallet_balance_summary` (used for reconciliation)
- Stored procedures: `process_transfer`, escrow fund / release / refund, dispute resolution
- Trigger: escrow status audit, writes to `escrow_status_audit` on every status change. It records the acting user from the session variable `@app_user_id`, so any code that changes an escrow must go through `withActor(userId, fn)` in `lib/mysql.js`.
- System wallets: escrow holding wallet, top-up source wallet

MongoDB collections: `dispute_cases`, `kyc_documents`, `activity_logs`

`db/schema.sql` and `db/schema_escrow.sql` are the source of truth. Read them before writing any query.

## Rules (do not break these)

1. **All money moves go through stored procedures.** Never UPDATE a wallet balance or INSERT a ledger entry directly from app code. Transfers call `process_transfer`; escrow actions call the escrow procedures.
2. **Every transfer is double-entry.** Each transaction produces a balanced debit and credit in `ledger_entries`. Debits always equal credits.
3. **Amounts are `DECIMAL`.** Never use floats in SQL or JavaScript for money. Pass amounts as strings or integer paise across the API.
4. **Lock rows in a consistent order** (by wallet id) inside procedures to avoid deadlocks.
5. **Idempotency keys** are required on transfer and escrow action endpoints. A repeated key returns the original result, it does not move money twice.
6. **Escrow state machine:** `created → funded → completed → released`, with `refunded` and `disputed` branches. Reject invalid transitions with a clear error.
7. **No hardcoded credentials.** All secrets come from `.env` (see `.env.example`). Never commit `.env`.
8. **Use parameterized queries** everywhere. No string-built SQL.

## Ownership

- **Member A (Money Core):** ledger tables, view, `process_transfer`, escrow procedures, add-funds / transfer / escrow APIs, idempotency, reconciliation page, stress test.
- **Member B (Users, Disputes, Interface):** escrow tables, audit trigger, seed data, Mongo setup and aggregation, auth, dispute API and resolution procedure, all other pages, admin analytics.

Do not edit the other member's files without asking them. API request and response shapes are agreed in `docs/api.md`; update that file before changing an endpoint.

## Git

- Branch per feature (`feature/transfer-api`, `feature/auth`), merged to `main` by pull request.
- Each person commits their own work under their own name.
- Clear commit messages, e.g. `Add process_transfer stored procedure with row locking`.

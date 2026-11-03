# PayTrust

Escrow-backed payments app for our DBMS project. Next.js, MySQL for money, MongoDB for disputes, KYC and activity logs.

## Requirements

- Node.js 20 or newer
- MySQL 8 (or MariaDB 10.11+)
- MongoDB 6 or newer (local install or a free Atlas cluster)

## Setup

**1. Install packages and create your env file**

```bash
npm install
cp .env.example .env      # then edit .env with your own passwords
```

On Windows (cmd): `copy .env.example .env`

The `npm run db:...` scripts read `.env`. Next.js also reads `.env.local`; if you already have one, copy it to `.env` too.

**2. Create the MySQL database and an app user**

```sql
CREATE DATABASE paytrust CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'paytrust_app'@'localhost' IDENTIFIED BY 'your_password';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON paytrust.* TO 'paytrust_app'@'localhost';
```

**3. Load the schema and data, in this order**

```bash
mysql -u root -p paytrust < db/schema.sql           # Member A: users, wallets, transactions, ledger
mysql -u root -p paytrust < db/schema_escrow.sql    # Member B: escrows, escrow_status_audit
mysql -u root -p paytrust < db/procedures.sql       # Member A: money procedures, create_escrow
mysql -u root -p paytrust < db/disputes.sql         # Member B: resolve_dispute procedure
mysql -u root -p paytrust < db/triggers.sql         # Member B: escrow audit trigger
mysql -u root -p paytrust < db/seed.sql             # Member B: demo users and escrows
mysql -u root -p paytrust < db/seed_part2.sql       # Member A: demo money and escrow steps
mysql -u root -p paytrust < db/seed_bulk.sql        # Member A: bulk demo data (20 more users, escrows in every state)
```

Run these as root (or another admin account). The app user above can't create tables or triggers, on purpose.

`db/seed_bulk.sql` is optional but recommended for demos: it adds 20 users (ids 201 to 220), about 100 money movements and escrows in every state. Run it once only. All of its money goes through the stored procedures, so the ledger still reconciles.

**Shortcut: everything in one file.** `db/paytrust_full.sql` contains all of the above (it also creates the database). It **drops and recreates** the `paytrust` database:

```bash
mysql -u root -p < db/paytrust_full.sql
```

**4. Set up MongoDB collections, indexes and demo data**

```bash
npm run db:mongo                                     # collections, validators, indexes
npm run db:mongo-seed                                # demo dispute case for escrow 3 (run after seed_part2.sql)
node --env-file=.env db/mongo_seed_bulk.mjs          # bulk KYC documents, dispute cases and activity logs
```

The bulk script builds its documents from the MySQL rows, so run it after `seed_bulk.sql`. It is safe to run twice. To rebuild its activity logs, add `--reset`.

**5. Start the app**

```bash
npm run dev
```

Open http://localhost:3000. The home page shows whether MySQL and MongoDB are connected. The same check as JSON is at `/api/health`.

## Demo logins

All seeded users have the password `Demo@1234`.

| Email | Role |
|---|---|
| admin@paytrust.test | admin |
| aarav@paytrust.test | user |
| diya@paytrust.test | user |
| kabir@paytrust.test | user |
| meera@paytrust.test | user |
| rohan@paytrust.test | user |

The bulk data adds 20 more users with the same password and emails like `ananya@paytrust.test`, `vikram@paytrust.test`, `ishita@paytrust.test` (the first name, lower case). Their ids are 201 to 220.

## How money moves

- Every rupee moves through MySQL stored procedures. Each movement is one `transactions` row plus exactly two `ledger_entries` rows (a debit and a credit), so the books always balance.
- Escrow lifecycle: `created` to `funded` to `completed` to `released`, with `refunded` and `disputed` branches. Buttons for each step are on the escrow detail page.
- The admin Reconciliation page checks every wallet's stored balance against its ledger entries.
- The money API is documented in `docs/api-ledger.md`.

## Project layout

```
app/                 Next.js pages and API routes
  api/health/        connection test
  api/escrow/        create an escrow, plus fund / complete / release / refund / dispute
  admin/reconciliation/   ledger health check (admin only)
lib/
  mysql.js           MySQL pool, query(), withActor() for audited changes
  mongo.js           MongoDB client
  ledger.js          calls to the money stored procedures, error mapping
  reconciliation.js  ledger health check used by the API and the page
  disputeAnalytics.js  aggregation pipeline for the admin dashboard
db/
  schema.sql         ledger tables (Member A)
  schema_escrow.sql  escrow tables (Member B)
  procedures.sql     money stored procedures and append-only triggers (Member A)
  disputes.sql       resolve_dispute procedure (Member B)
  triggers.sql       escrow status audit trigger
  seed.sql           demo users and escrows
  seed_part2.sql     demo money and escrow steps
  seed_bulk.sql      bulk demo data
  paytrust_full.sql  the whole MySQL database in one file
  mongo_setup.mjs    Mongo collections, validators, indexes
  mongo_seed.mjs     one demo dispute case
  mongo_seed_bulk.mjs  bulk KYC, dispute and activity data
  mongo_analytics.mjs  prints dispute analytics
docs/
  api.md, api-ledger.md   API reference
  PayTrust_Project_Documentation_v3.pdf   full project document
  PayTrust_Relational_Schema.pdf          relational schema
  er_diagram.png                          ER diagram
  sample-data/                            table contents as CSV files
scripts/
  stress_test.mjs    concurrency stress test (see below)
```

## Useful commands

```bash
npm run db:analytics   # print dispute analytics from MongoDB
node --env-file=.env scripts/stress_test.mjs   # concurrency stress test
```

Run the stress test against a separate database (the ledger is append-only, so test rows cannot be deleted): create `paytrust_test`, load `schema.sql`, `schema_escrow.sql`, `procedures.sql`, `disputes.sql` and `triggers.sql` into it, and point `MYSQL_DATABASE` at it for that run. You want `ALL CHECKS PASSED` at the end.

## Troubleshooting

- **MySQL "Access denied"**: check `MYSQL_USER` and `MYSQL_PASSWORD` in `.env`, and that you ran the GRANT above.
- **`node: .env: not found`**: the db scripts need a file named `.env` (copy `.env.local` if that is what you have).
- **MongoDB "ECONNREFUSED"**: MongoDB isn't running. Start it (`brew services start mongodb-community` on Mac, or the MongoDB service on Windows), or use an Atlas connection string in `MONGODB_URI`.
- **Foreign key error loading schema_escrow.sql**: load Member A's `schema.sql` first.
- **"Duplicate entry ... for key 'users.PRIMARY'" when loading seed_bulk.sql**: it was already loaded once. Check with `SELECT COUNT(*) FROM users WHERE id >= 201;` (20 means it is there).
- **`create_escrow` does not exist**: re-run `db/procedures.sql` (it is safe to run again).
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

**2. Create the MySQL database and an app user**

```sql
CREATE DATABASE paytrust;
CREATE USER 'paytrust_app'@'localhost' IDENTIFIED BY 'your_password';
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON paytrust.* TO 'paytrust_app'@'localhost';
```

**3. Load the schema, in this order**

```bash
mysql -u root -p paytrust < db/schema.sql           # Member A: users, wallets, transactions, ledger
mysql -u root -p paytrust < db/schema_escrow.sql    # Member B: escrows, escrow_status_audit
mysql -u root -p paytrust < db/procedures.sql       # Member A: process_transfer, escrow procedures
mysql -u root -p paytrust < db/triggers.sql         # Member B: escrow audit trigger
mysql -u root -p paytrust < db/seed.sql             # Member B: demo users and escrows
```

Run these as root (or another admin account). The app user above can't create tables or triggers, on purpose.

**4. Set up MongoDB collections and indexes**

```bash
npm run db:mongo
```

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

## Project layout

```
app/                 Next.js pages and API routes
  api/health/        connection test
lib/
  mysql.js           MySQL pool, query(), withActor() for audited changes
  mongo.js           MongoDB client
  disputeAnalytics.js  aggregation pipeline for the admin dashboard
db/
  schema.sql         ledger tables (Member A)
  schema_escrow.sql  escrow tables (Member B)
  triggers.sql       escrow status audit trigger
  seed.sql           demo data
  mongo_setup.mjs    Mongo collections, validators, indexes
  mongo_analytics.mjs  prints dispute analytics
```

## Useful commands

```bash
npm run db:analytics   # print dispute analytics from MongoDB
```

## Troubleshooting

- **MySQL "Access denied"**: check `MYSQL_USER` and `MYSQL_PASSWORD` in `.env`, and that you ran the GRANT above.
- **MongoDB "ECONNREFUSED"**: MongoDB isn't running. Start it (`brew services start mongodb-community` on Mac, or the MongoDB service on Windows), or use an Atlas connection string in `MONGODB_URI`.
- **Foreign key error loading schema_escrow.sql**: load Member A's `schema.sql` first.

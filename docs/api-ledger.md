# PayTrust money APIs (Member A)

All amounts are **strings** with up to 2 decimals (`"500.00"`). Every money-moving call needs an
`Idempotency-Key` header (max 64 chars; generate one UUID per user action and reuse it on retry).
Money moves only inside MySQL stored procedures; the acting user comes from the session.

Success: `201` first time, `200` if it was a replay (`"replayed": true`, nothing moved twice).
Errors: `{ "error": { "code": "...", "message": "..." } }`

| Code | HTTP | Meaning |
|---|---|---|
| INVALID_INPUT | 400 | bad amount / id / missing Idempotency-Key |
| FORBIDDEN | 403 | not signed in, not your wallet/escrow, frozen account |
| NOT_FOUND | 404 | wallet or escrow does not exist |
| INVALID_TRANSITION | 409 | escrow is not in the right state for this step |
| IDEMPOTENCY_CONFLICT | 409 | same key reused for a different request |
| INSUFFICIENT_BALANCE | 422 | wallet cannot cover the amount |

| Method + path | Body | Who | Response |
|---|---|---|---|
| POST `/api/wallet/add-funds` | `{amount}` | the user (admin: any) | `{txnId, replayed}` |
| POST `/api/transfer` | `{fromWalletId,toWalletId,amount}` | owner of from-wallet | `{txnId, replayed}` |
| POST `/api/escrow` | `{seller_email, amount, title, description?}` | any signed-in user (not admin); the buyer is the logged-in user | `201 {escrowId, replayed}` |
| POST `/api/escrow/:id/fund` | – | buyer | `{txnId, replayed}` |
| POST `/api/escrow/:id/complete` | – | seller | `{escrowId, status, replayed}` |
| POST `/api/escrow/:id/release` | – | buyer (disputed: admin) | `{txnId, replayed}` |
| POST `/api/escrow/:id/refund` | – | seller (disputed: admin) | `{txnId, replayed}` |
| POST `/api/escrow/:id/dispute` | – | buyer / seller | `{escrowId, status, replayed}` |
| GET `/api/admin/reconciliation` | – | admin | `{wallets[], mismatchedWallets, unbalancedTransactions, sumOfAllBalances, healthy}` |

### Create an escrow

`POST /api/escrow` with an `Idempotency-Key` header and body
`{ "seller_email": "diya@paytrust.test", "amount": "2500.00", "title": "Logo design", "description": "optional" }`.
The buyer is the logged-in user. Creating an escrow moves no money: it starts in `created`, and the buyer funds it next
(`POST /api/escrow/:id/fund`).

- `201 { "escrowId": "7", "replayed": false }`. Repeating the same request (same key and details) returns `200` with the same `escrowId` and `replayed: true`, and no second escrow is created.
- `400 INVALID_INPUT`: bad amount, title not 3 to 120 characters, details over 1000 characters, missing `Idempotency-Key`, no active user with that email, or the seller is the buyer. (An unknown seller email is a 400, not a 404, so the form can show the message.)
- `403 FORBIDDEN`: not signed in, frozen account, or an admin account.
- `409 IDEMPOTENCY_CONFLICT`: the key was already used for a different escrow.

Implemented by the `create_escrow` stored procedure in `db/procedures.sql` (re-run that file to get it).

Escrow states: `created → funded → completed → released`; `funded|completed → refunded`;
`funded|completed → disputed → released|refunded` (admin decides).

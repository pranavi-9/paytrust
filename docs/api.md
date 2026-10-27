# PayTrust API contract

Agreed request and response shapes. **Update this file before changing an endpoint**, so the frontend and backend stay in sync.

Conventions for every endpoint:
- JSON in, JSON out. Errors look like `{ "error": "message", "fields": { "field": "message" } }` (`fields` only for validation errors).
- Auth is an httpOnly cookie (`pt_session`) set by login/register. Logged-out requests to protected endpoints get `401`; wrong role gets `403`.
- Money amounts are **strings** with up to 2 decimals (`"499.50"`), never JSON numbers.
- Endpoints that move money require an `Idempotency-Key` header (a UUID). Repeating a request with the same key returns the original result and moves no money.

Status codes: `200` ok, `201` created, `400` bad JSON, `401` not logged in, `403` not allowed, `404` not found, `409` conflict, `422` validation error, `500` server error.

---

## Auth (Member B) — built

### `POST /api/auth/register`
Request: `{ "full_name": "Diya Patel", "email": "diya@example.com", "password": "at-least-8" }`
Creates the user (role `user`) and an empty wallet in one transaction, then logs them in.
- `201` `{ "user": { "id": 7, "full_name": "Diya Patel", "email": "diya@example.com", "role": "user" } }`
- `409` email already registered · `422` validation errors in `fields`

### `POST /api/auth/login`
Request: `{ "email": "...", "password": "..." }`
- `200` `{ "user": { "id", "full_name", "email", "role" } }` and sets the cookie
- `401` `{ "error": "Invalid email or password" }` (same message for unknown email or wrong password)

### `POST /api/auth/logout`
- `200` `{ "ok": true }` and clears the cookie

### `GET /api/auth/me`
- `200` `{ "user": { "id", "full_name", "email", "role" } }` · `401` if logged out

### Server helpers for your routes
```js
import { requireApiSession } from '@/lib/auth';
const auth = await requireApiSession();        // or requireApiSession('admin')
if (auth.error) return auth.error;             // 401 / 403 already formatted
const userId = auth.session.userId;
```

---

## Users (Member B)

### `GET /api/users/lookup?email=diya@paytrust.test`
Logged-in users only. Finds a recipient for Send money.
- `200` `{ "name": "Diya Patel", "walletId": "4" }`
- `400` empty email or your own email · `404` no active user with that email
- Errors use A's shape: `{ "error": { "code", "message" } }`

---

## Money and escrow (Member A)

See **`docs/api-ledger.md`**: add funds, transfer, escrow fund/complete/release/refund/dispute, reconciliation.
Those routes return errors as `{ "error": { "code", "message" } }`, and get the user from the session through `getActorId()` in `lib/auth.js`.

---

## Disputes (Member B)

Cases live in MongoDB (`dispute_cases`); the escrow and all money stay in MySQL.
Errors use the same shape as A's money routes: `{ "error": { "code", "message" } }`.

### `POST /api/disputes`
Buyer or seller of a **funded or completed** escrow.
Request: `{ "escrow_id": 2, "reason": "not_delivered", "description": "at least 10 characters" }`
`reason` is one of `not_delivered`, `not_as_described`, `partial_delivery`, `quality_issue`, `other`.
Saves the case in MongoDB, then calls A's `dispute_escrow`. If that call fails, the case is deleted again.
- `201` `{ "caseId": "6ae0…" }`
- `400` bad input · `404` escrow not found or not yours · `409` `INVALID_TRANSITION` (wrong escrow status) or `ALREADY_DISPUTED` (also returns the existing `caseId`)

### `POST /api/disputes/:id/messages`
Buyer, seller or admin. Request: `{ "body": "..." }` (max 2000). The admin's first message moves the case to `under_review`.
- `201` `{ "message": { sender_id, body, sent_at } }` · `404` not your case · `409` case is resolved

### `POST /api/disputes/:id/evidence`
Buyer or seller only. Request: `{ "file_url": "https://…", "caption": "optional" }`. Links only (http/https), max 10 per case.
- `201` `{ "evidence": { uploaded_by, file_url, caption, uploaded_at } }` · `400` bad link · `403` admin · `409` resolved or full

### `POST /api/disputes/:id/resolve`
Admin only. Header: `Idempotency-Key`. Request: `{ "decision": "release" | "refund", "note": "why" }`.
`release` pays the seller, `refund` pays the buyer back. Calls `resolve_dispute` (db/disputes.sql), which only accepts a **disputed** escrow and then calls A's `release_escrow` / `refund_escrow`. Then the case is closed in MongoDB with the decision, note and ledger transaction id.
- `201` `{ "caseId", "decision", "txnId", "replayed": false }`
- `200` same body with `"replayed": true` when repeated (no money moves twice)
- `403` not admin · `409` already resolved the other way, or escrow not disputed

---

## KYC (Member B)

Documents live in MongoDB (`kyc_documents`); `users.kyc_status` in MySQL is recomputed from them after every change (verified if any document is verified, else pending if any is pending, else rejected).

### `POST /api/kyc`
Logged-in user (not admin). Request: `{ "doc_type": "pan", "last4": "123F", "file_url": "https://…" }`.
`doc_type` is one of `aadhaar`, `pan`, `passport`, `driving_licence`, `voter_id`. Only the last 4 characters are sent; they are stored as a mask (`XXXXXX123F`). One document per type; a rejected one can be submitted again.
- `201` `{ "status": "pending", "kycStatus": "pending" }` · `400` bad input · `409` that type is already pending or verified

### `POST /api/admin/kyc/:id`
Admin only. Request: `{ "decision": "verify" | "reject", "reason": "required when rejecting" }`.
- `200` `{ "status", "kycStatus", "replayed" }` (`replayed: true` when the same decision is repeated) · `409` already decided the other way

## Admin: users (Member B)

### `POST /api/admin/users/:id/active`
Admin only. Request: `{ "active": false }` freezes, `{ "active": true }` unfreezes. Admin accounts can't be frozen.
A frozen user can still log in, but A's money procedures refuse every action for them and they can't be found as a transfer recipient.
- `200` `{ "userId", "active" }` · `400` bad body · `404` no such user (or an admin)

## Pages added in week 4
`/transactions` (wallet history from the ledger, filter by type, paged) · `/profile` (account, KYC) · `/admin/users` and `/admin/users/:id` (search, KYC review, freeze) · `/admin/escrows` (all escrows, search, status filter, sort) · `/admin/analytics` (MySQL money stats incl. CTE + window-function ranking, MongoDB dispute and activity aggregations, time range filter)

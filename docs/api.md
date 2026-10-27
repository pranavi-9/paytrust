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

## Disputes (Member B) — week 3
`POST /api/disputes`, `POST /api/disputes/:id/evidence`, `POST /api/disputes/:id/messages`, `POST /api/disputes/:id/resolve` (admin). Shapes to be added here before building.

Agreed with A: raising a dispute calls `CALL dispute_escrow(id)` as the buyer or seller, then stores the case in MongoDB. The admin decision calls `release_escrow` or `refund_escrow` as the admin (through `lib/ledger.js`).

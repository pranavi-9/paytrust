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

## Money (Member A) — to build

### `POST /api/wallet/add-funds`
Headers: `Idempotency-Key`
Request: `{ "amount": "1000.00" }`
- `201` `{ "transaction_id": 12, "balance": "1500.00" }`

### `POST /api/transfers`  (the Send money page already calls this)
Headers: `Idempotency-Key`
Request: `{ "to_email": "diya@example.com", "amount": "250.00", "note": "optional, max 140 chars" }`
- `201` `{ "transaction_id": 13, "balance": "1250.00" }` (sender's new balance)
- `404` recipient not found · `409` insufficient balance · `422` bad amount or sending to yourself

### Escrow actions (week 3) — A fills in
`POST /api/escrows` (create), `POST /api/escrows/:id/fund`, `/complete`, `/release`
Each money-moving action takes `Idempotency-Key` and returns `{ "escrow": { ...row } }`, or `409` with the reason if the state machine rejects the transition.

---

## Disputes (Member B) — week 3
`POST /api/disputes`, `POST /api/disputes/:id/evidence`, `POST /api/disputes/:id/messages`, `POST /api/disputes/:id/resolve` (admin). Shapes to be added here before building.

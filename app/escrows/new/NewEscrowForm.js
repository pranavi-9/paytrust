'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const AMOUNT_RE = /^\d{1,13}(\.\d{1,2})?$/;
const errorText = (json, fallback) =>
  (typeof json?.error === 'string' ? json.error : json?.error?.message) || fallback;

// Calls Member A's POST /api/escrow (see docs/api-ledger.md).
// Expected body:     { seller_email, amount, title, description }
// Expected response: 201 { escrowId }
export default function NewEscrowForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const idemKey = useRef(crypto.randomUUID());

  async function onSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const amount = String(data.amount).trim();
    const title = String(data.title).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(data.seller_email).trim())) return setError('Enter the seller’s email');
    if (!AMOUNT_RE.test(amount) || /^0+(\.0+)?$/.test(amount)) return setError('Enter an amount like 2500 or 499.50');
    if (title.length < 3) return setError('Give the escrow a short title');

    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/escrow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey.current },
        body: JSON.stringify({
          seller_email: String(data.seller_email).trim().toLowerCase(),
          amount,
          title,
          description: String(data.description).trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (res.status === 404 || res.status === 405 || (!res.ok && json === null)) {
        setError('Creating escrows isn’t available yet (Member A’s POST /api/escrow).');
      } else if (!res.ok) {
        setError(errorText(json, 'Could not create the escrow'));
      } else if (json?.escrowId) {
        router.push(`/escrows/${json.escrowId}`);
        router.refresh();
        return;
      } else {
        router.push('/escrows');
        router.refresh();
        return;
      }
    } catch {
      setError('Could not reach the server');
    }
    setBusy(false);
  }

  return (
    <form className="card form" onSubmit={onSubmit} noValidate>
      <label className="field">
        <span>Seller’s email</span>
        <input name="seller_email" type="email" required />
      </label>
      <label className="field">
        <span>Amount (₹)</span>
        <input name="amount" inputMode="decimal" placeholder="2500.00" required />
      </label>
      <label className="field">
        <span>What are you paying for?</span>
        <input name="title" maxLength={120} placeholder="Logo design" required />
      </label>
      <label className="field">
        <span>Details (optional)</span>
        <textarea name="description" maxLength={1000} placeholder="What the seller will deliver, and by when" />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create escrow'}</button>
    </form>
  );
}

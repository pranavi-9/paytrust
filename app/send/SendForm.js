'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const AMOUNT_RE = /^\d{1,13}(\.\d{1,2})?$/;

// Posts to Member A's transfer API (shape agreed in docs/api.md).
export default function SendForm() {
  const router = useRouter();
  const [status, setStatus] = useState(null); // { kind: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false);
  // One key per attempt: a double-click or retry reuses it, so money moves once.
  const idemKey = useRef(crypto.randomUUID());

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const amount = String(data.amount).trim();

    if (!AMOUNT_RE.test(amount) || /^0+(\.0+)?$/.test(amount)) {
      setStatus({ kind: 'error', text: 'Enter an amount like 500 or 499.50' });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey.current },
        body: JSON.stringify({ to_email: String(data.to_email).trim().toLowerCase(), amount, note: data.note || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 404 && !json.error) {
        setStatus({ kind: 'error', text: 'Transfers aren’t built yet (Member A’s transfer API).' });
      } else if (!res.ok) {
        setStatus({ kind: 'error', text: json.error || 'Transfer failed' });
      } else {
        setStatus({ kind: 'ok', text: 'Money sent.' });
        form.reset();
        idemKey.current = crypto.randomUUID(); // fresh key for the next transfer
        router.refresh(); // update the balance shown above
      }
    } catch {
      setStatus({ kind: 'error', text: 'Could not reach the server' });
    }
    setBusy(false);
  }

  return (
    <form className="card form" onSubmit={onSubmit} noValidate>
      <label className="field">
        <span>Recipient’s email</span>
        <input name="to_email" type="email" required />
      </label>
      <label className="field">
        <span>Amount (₹)</span>
        <input name="amount" inputMode="decimal" placeholder="500.00" required />
      </label>
      <label className="field">
        <span>Note (optional)</span>
        <input name="note" maxLength={140} />
      </label>
      {status && <p className={status.kind === 'ok' ? 'form-ok' : 'form-error'} role="status">{status.text}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send'}</button>
    </form>
  );
}

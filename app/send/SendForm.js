'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const AMOUNT_RE = /^\d{1,13}(\.\d{1,2})?$/;

// Error bodies come in two shapes: { error: "text" } from auth routes and
// { error: { code, message } } from Member A's money routes.
const errorText = (json, fallback) =>
  (typeof json?.error === 'string' ? json.error : json?.error?.message) || fallback;

// Step 1: look up the recipient by email and show their name.
// Step 2: confirm, which calls Member A's POST /api/transfer.
export default function SendForm({ fromWalletId }) {
  const router = useRouter();
  const [recipient, setRecipient] = useState(null); // { name, walletId, email, amount }
  const [status, setStatus] = useState(null); // { kind: 'ok' | 'error', text }
  const [busy, setBusy] = useState(false);
  // One key per transfer: a double-click or retry reuses it, so money moves once.
  const idemKey = useRef(crypto.randomUUID());

  async function lookUp(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const email = String(data.to_email).trim().toLowerCase();
    const amount = String(data.amount).trim();

    if (!AMOUNT_RE.test(amount) || /^0+(\.0+)?$/.test(amount)) {
      setStatus({ kind: 'error', text: 'Enter an amount like 500 or 499.50' });
      return;
    }

    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch(`/api/users/lookup?email=${encodeURIComponent(email)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setStatus({ kind: 'error', text: errorText(json, 'Could not find that user') });
      else setRecipient({ ...json, email, amount });
    } catch {
      setStatus({ kind: 'error', text: 'Could not reach the server' });
    }
    setBusy(false);
  }

  async function confirm() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idemKey.current },
        body: JSON.stringify({ fromWalletId, toWalletId: recipient.walletId, amount: recipient.amount }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ kind: 'error', text: errorText(json, 'Transfer failed') });
      } else {
        setStatus({ kind: 'ok', text: `Sent ₹${recipient.amount} to ${recipient.name}.` });
        setRecipient(null);
        idemKey.current = crypto.randomUUID(); // fresh key for the next transfer
        router.refresh(); // update the balance shown above
      }
    } catch {
      setStatus({ kind: 'error', text: 'Could not reach the server' });
    }
    setBusy(false);
  }

  if (recipient) {
    return (
      <div className="card form">
        <p style={{ margin: 0 }}>
          Send <strong>₹{recipient.amount}</strong> to <strong>{recipient.name}</strong>
          <br />
          <span className="muted">{recipient.email}</span>
        </p>
        {status && <p className="form-error" role="alert">{status.text}</p>}
        <button className="btn primary" onClick={confirm} disabled={busy}>{busy ? 'Sending…' : 'Confirm and send'}</button>
        <button className="btn" onClick={() => { setRecipient(null); setStatus(null); }} disabled={busy}>Back</button>
      </div>
    );
  }

  return (
    <form className="card form" onSubmit={lookUp} noValidate>
      <label className="field">
        <span>Recipient’s email</span>
        <input name="to_email" type="email" required />
      </label>
      <label className="field">
        <span>Amount (₹)</span>
        <input name="amount" inputMode="decimal" placeholder="500.00" required />
      </label>
      {status && <p className={status.kind === 'ok' ? 'form-ok' : 'form-error'} role="status">{status.text}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
    </form>
  );
}

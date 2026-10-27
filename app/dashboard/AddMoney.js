'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const AMOUNT_RE = /^\d{1,13}(\.\d{1,2})?$/;
const QUICK = ['500', '1000', '5000'];
const errorText = (json, fallback) =>
  (typeof json?.error === 'string' ? json.error : json?.error?.message) || fallback;

// Simulated top-up through Member A's POST /api/wallet/add-funds.
// No real payment happens: the money comes from the system top-up wallet.
export default function AddMoney() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(crypto.randomUUID());

  async function onSubmit(e) {
    e.preventDefault();
    const a = amount.trim();
    if (!AMOUNT_RE.test(a) || /^0+(\.0+)?$/.test(a)) return setStatus({ kind: 'error', text: 'Enter an amount like 1000 or 499.50' });
    if (Number(a) > 100000) return setStatus({ kind: 'error', text: 'Add at most ₹1,00,000 at a time' });

    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/wallet/add-funds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key.current },
        body: JSON.stringify({ amount: a }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus({ kind: 'error', text: errorText(json, 'Could not add money') });
      } else {
        setStatus({ kind: 'ok', text: `Added ₹${a} to your wallet.` });
        setAmount('');
        key.current = crypto.randomUUID(); // fresh key for the next top-up
        router.refresh();
      }
    } catch {
      setStatus({ kind: 'error', text: 'Could not reach the server' });
    }
    setBusy(false);
  }

  if (!open) {
    return (
      <>
        <button className="btn" type="button" onClick={() => { setOpen(true); setStatus(null); }}>Add money</button>
        {status?.kind === 'ok' && <p className="form-ok" role="status" style={{ flexBasis: '100%' }}>{status.text}</p>}
      </>
    );
  }

  return (
    <form className="card form" onSubmit={onSubmit} noValidate style={{ flexBasis: '100%', marginTop: 0 }}>
      <label className="field">
        <span>Add money (₹)</span>
        <input value={amount} onChange={(e) => { setAmount(e.target.value); setStatus(null); }} inputMode="decimal" placeholder="1000" autoFocus />
        <small className="muted">Demo top-up: no real payment is taken.</small>
      </label>
      <div className="chips" style={{ margin: 0 }}>
        {QUICK.map((q) => (
          <button key={q} type="button" className={`chip ${amount === q ? 'on' : ''}`} onClick={() => { setAmount(q); setStatus(null); }}>₹{Number(q).toLocaleString('en-IN')}</button>
        ))}
      </div>
      {status && <p className={status.kind === 'ok' ? 'form-ok' : 'form-error'} role="status">{status.text}</p>}
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add money'}</button>
        <button className="btn" type="button" disabled={busy} onClick={() => { setOpen(false); setStatus(null); }}>Cancel</button>
      </div>
    </form>
  );
}

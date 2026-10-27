'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

const errorText = (json, fallback) =>
  (typeof json?.error === 'string' ? json.error : json?.error?.message) || fallback;

function useAction(url) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(body, headers = {}) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(errorText(json, 'Something went wrong'));
        setBusy(false);
        return false;
      }
      router.refresh();
      setBusy(false);
      return true;
    } catch {
      setError('Could not reach the server');
      setBusy(false);
      return false;
    }
  }
  return { send, error, setError, busy };
}

export function MessageForm({ caseId }) {
  const { send, error, setError, busy } = useAction(`/api/disputes/${caseId}/messages`);
  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = new FormData(form).get('body').trim();
    if (!body) return setError('Write a message');
    if (await send({ body })) form.reset();
  }
  return (
    <form className="form" onSubmit={onSubmit} style={{ marginTop: 16 }} noValidate>
      <label className="field">
        <span>Add a message</span>
        <textarea name="body" maxLength={2000} required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
    </form>
  );
}

export function EvidenceForm({ caseId }) {
  const { send, error, setError, busy } = useAction(`/api/disputes/${caseId}/evidence`);
  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (!/^https?:\/\//i.test(String(data.file_url).trim())) return setError('Enter a full link starting with https://');
    if (await send({ file_url: data.file_url, caption: data.caption })) form.reset();
  }
  return (
    <form className="form" onSubmit={onSubmit} style={{ marginTop: 16 }} noValidate>
      <label className="field">
        <span>Link to evidence</span>
        <input name="file_url" type="url" inputMode="url" placeholder="https://drive.google.com/…" required />
        <small className="muted">A photo, receipt, tracking page or chat screenshot, shared as a link.</small>
      </label>
      <label className="field">
        <span>What does it show? (optional)</span>
        <input name="caption" maxLength={500} />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add evidence'}</button>
    </form>
  );
}

export function ResolvePanel({ caseId, amount, buyer, seller }) {
  const { send, error, setError, busy } = useAction(`/api/disputes/${caseId}/resolve`);
  const [decision, setDecision] = useState('');
  // One key per decision attempt, so a double-click or retry can't move money twice.
  const key = useRef(crypto.randomUUID());

  async function onSubmit(e) {
    e.preventDefault();
    const note = new FormData(e.currentTarget).get('note').trim();
    if (!decision) return setError('Choose who gets the money');
    if (note.length < 5) return setError('Add a short note explaining the decision');
    const who = decision === 'release' ? `${seller} (seller)` : `${buyer} (buyer)`;
    if (!window.confirm(`Send ${amount} to ${who}? This can’t be undone.`)) return;
    await send({ decision, note }, { 'Idempotency-Key': key.current });
  }

  return (
    <form className="card form callout warn" onSubmit={onSubmit} noValidate>
      <strong>Admin decision</strong>
      <div className="field">
        <span>Who gets the {amount}?</span>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="radio" name="decision" value="release" checked={decision === 'release'} onChange={() => { setDecision('release'); key.current = crypto.randomUUID(); }} />
          Release to {seller} (seller)
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="radio" name="decision" value="refund" checked={decision === 'refund'} onChange={() => { setDecision('refund'); key.current = crypto.randomUUID(); }} />
          Refund to {buyer} (buyer)
        </label>
      </div>
      <label className="field">
        <span>Reason for the decision</span>
        <textarea name="note" maxLength={2000} required placeholder="Both parties will see this." />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Resolving…' : 'Resolve dispute'}</button>
    </form>
  );
}

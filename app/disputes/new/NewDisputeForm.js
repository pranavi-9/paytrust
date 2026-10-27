'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const errorText = (json, fallback) =>
  (typeof json?.error === 'string' ? json.error : json?.error?.message) || fallback;

export default function NewDisputeForm({ escrowId, reasons }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    if (!data.reason) return setError('Choose a reason');
    if (String(data.description).trim().length < 10) return setError('Describe the problem in at least 10 characters');

    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/disputes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ escrow_id: escrowId, reason: data.reason, description: data.description }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok || json.caseId) {
        router.push(`/disputes/${json.caseId}`);
        router.refresh();
        return;
      }
      setError(errorText(json, 'Could not raise the dispute'));
    } catch {
      setError('Could not reach the server');
    }
    setBusy(false);
  }

  return (
    <form className="card form" onSubmit={onSubmit} noValidate>
      <label className="field">
        <span>What went wrong?</span>
        <select name="reason" defaultValue="" required>
          <option value="" disabled>Choose a reason</option>
          {Object.entries(reasons).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Describe the problem</span>
        <textarea name="description" maxLength={2000} required placeholder="What was agreed, and what actually happened?" />
        <small className="muted">You can add evidence links and messages on the next page.</small>
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Raising…' : 'Raise dispute'}</button>
    </form>
  );
}

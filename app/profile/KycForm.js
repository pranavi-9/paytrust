'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const errorText = (json, fallback) =>
  (typeof json?.error === 'string' ? json.error : json?.error?.message) || fallback;

export default function KycForm({ docTypes }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (!data.doc_type) return setError('Choose a document type');
    if (!/^[0-9a-zA-Z]{4}$/.test(String(data.last4).trim())) return setError('Enter exactly the last 4 letters or digits');
    if (!/^https?:\/\//i.test(String(data.file_url).trim())) return setError('Enter a full link starting with https://');

    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/kyc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(errorText(json, 'Could not submit the document'));
      else {
        form.reset();
        router.refresh();
      }
    } catch {
      setError('Could not reach the server');
    }
    setBusy(false);
  }

  return (
    <form className="card form" onSubmit={onSubmit} noValidate>
      <strong>Submit a document</strong>
      <label className="field">
        <span>Document type</span>
        <select name="doc_type" defaultValue="" required>
          <option value="" disabled>Choose one</option>
          {Object.entries(docTypes).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Last 4 characters of the ID number</span>
        <input name="last4" maxLength={4} autoComplete="off" placeholder="1234" style={{ maxWidth: 140 }} required />
        <small className="muted">We never ask for or store your full ID number.</small>
      </label>
      <label className="field">
        <span>Link to a photo or scan of the document</span>
        <input name="file_url" type="url" inputMode="url" placeholder="https://drive.google.com/…" required />
      </label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit for review'}</button>
    </form>
  );
}

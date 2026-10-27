'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const errorText = (json, fallback) =>
  (typeof json?.error === 'string' ? json.error : json?.error?.message) || fallback;

function usePost() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function post(url, body) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(errorText(json, 'Something went wrong'));
      else router.refresh();
      setBusy(false);
      return res.ok;
    } catch {
      setError('Could not reach the server');
      setBusy(false);
      return false;
    }
  }
  return { post, error, setError, busy };
}

export function KycReview({ docId }) {
  const { post, error, setError, busy } = usePost();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');

  if (rejecting) {
    return (
      <form
        className="form"
        style={{ marginTop: 12 }}
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          if (reason.trim().length < 5) return setError('Tell the user why (at least 5 characters)');
          await post(`/api/admin/kyc/${docId}`, { decision: 'reject', reason });
        }}
      >
        <label className="field">
          <span>Reason (the user will see this)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Photo is blurry; the name is not readable" autoFocus />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Reject document'}</button>
          <button className="btn" type="button" disabled={busy} onClick={() => { setRejecting(false); setError(''); }}>Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="actions" style={{ marginTop: 8 }}>
        <button className="btn primary" type="button" disabled={busy} onClick={() => post(`/api/admin/kyc/${docId}`, { decision: 'verify' })}>
          {busy ? 'Saving…' : 'Verify'}
        </button>
        <button className="btn" type="button" disabled={busy} onClick={() => setRejecting(true)}>Reject…</button>
      </div>
      {error && <p className="form-error" role="alert" style={{ marginTop: 8 }}>{error}</p>}
    </>
  );
}

export function FreezeToggle({ userId, active, name }) {
  const { post, error, busy } = usePost();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div style={{ marginTop: 6 }}>
        <p className="small-text" style={{ margin: '0 0 6px' }}>
          {active ? `Freeze ${name}? They won’t be able to move money.` : `Unfreeze ${name}?`}
        </p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button className="btn small primary" type="button" disabled={busy} onClick={async () => { if (await post(`/api/admin/users/${userId}/active`, { active: !active })) setConfirming(false); }}>
            {busy ? 'Saving…' : active ? 'Yes, freeze' : 'Yes, unfreeze'}
          </button>
          <button className="btn small" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </div>
        {error && <p className="form-error small-text" role="alert">{error}</p>}
      </div>
    );
  }
  return (
    <button className="btn small" type="button" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => setConfirming(true)}>
      {active ? 'Freeze account' : 'Unfreeze account'}
    </button>
  );
}

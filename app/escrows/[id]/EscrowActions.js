'use client';

// OWNED BY MEMBER A. Fund / Mark complete / Release / Refund buttons for the
// escrow detail page. They call the routes in docs/api-ledger.md.
//
// Props:
//   escrow: { id, status, amount }   amount is a string like "2500.00"
//   role:   'buyer' | 'seller' | 'admin'
//
// Who can do what (the database enforces the same rules; this only decides
// which buttons to show):
//   created    buyer: Fund
//   funded     seller: Mark complete, Refund
//   completed  buyer: Release        seller: Refund
//   disputed   nobody here; an admin decides from the dispute case
// Money-moving buttons (Fund, Release, Refund) ask for one extra click first.

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatINR } from '@/lib/format';

const ACTIONS = {
  fund:     { label: 'Fund escrow',   path: 'fund',     needsKey: true,  confirm: (a) => `Move ${a} from your wallet into escrow?`,        done: 'Escrow funded. The seller can start the work.' },
  complete: { label: 'Mark complete', path: 'complete', needsKey: false, confirm: null,                                                     done: 'Marked complete. Waiting for the buyer to release the money.' },
  release:  { label: 'Release money', path: 'release',  needsKey: true,  confirm: (a) => `Release ${a} to the seller? This cannot be undone.`, done: 'Money released to the seller.' },
  refund:   { label: 'Refund buyer',  path: 'refund',   needsKey: true,  confirm: (a) => `Refund ${a} to the buyer? This cannot be undone.`,   done: 'Refunded to the buyer.' },
};

const errorText = (json, fallback) =>
  (typeof json?.error === 'string' ? json.error : json?.error?.message) || fallback;

function buttonsFor(status, role) {
  if (role === 'buyer') {
    if (status === 'created') return ['fund'];
    if (status === 'completed') return ['release'];
  }
  if (role === 'seller') {
    if (status === 'funded') return ['complete', 'refund'];
    if (status === 'completed') return ['refund'];
  }
  return [];
}

function waitingNote(status, role) {
  if (status === 'created') return role === 'seller' ? 'Waiting for the buyer to fund this escrow.' : null;
  if (status === 'funded') return role === 'buyer' ? 'The money is held safely. Waiting for the seller to finish the work.' : null;
  if (status === 'completed') return role === 'seller' ? 'Waiting for the buyer to release the money.' : null;
  if (status === 'disputed') return 'This escrow is disputed. The money stays locked until an admin decides.';
  if (status === 'released') return 'Finished: the money was released to the seller.';
  if (status === 'refunded') return 'Finished: the money was refunded to the buyer.';
  return null;
}

export default function EscrowActions({ escrow, role }) {
  const router = useRouter();
  const [pending, setPending] = useState(null);   // action waiting for the confirm click
  const [busy, setBusy] = useState(null);         // action currently running
  const [message, setMessage] = useState(null);   // { kind: 'ok' | 'error', text }
  // One key per action: a double-click or retry reuses it so money moves once.
  const keys = useRef({});

  const buttons = buttonsFor(escrow.status, role);
  const note = waitingNote(escrow.status, role);
  if (buttons.length === 0 && !note && !message) return null;

  async function run(name) {
    const action = ACTIONS[name];
    setBusy(name);
    setMessage(null);
    if (!keys.current[name]) keys.current[name] = crypto.randomUUID();
    try {
      const res = await fetch(`/api/escrow/${escrow.id}/${action.path}`, {
        method: 'POST',
        headers: action.needsKey ? { 'Idempotency-Key': keys.current[name] } : {},
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        delete keys.current[name];
        setPending(null);
        setMessage({ kind: 'ok', text: action.done });
        router.refresh();               // reload status and history
      } else {
        setPending(null);
        setMessage({ kind: 'error', text: errorText(json, 'Something went wrong. Please try again.') });
        // The page was out of date (someone else already moved the escrow): reload it.
        if (res.status === 409) router.refresh();
      }
    } catch {
      setMessage({ kind: 'error', text: 'Could not reach the server. Try again.' });
    }
    setBusy(null);
  }

  function onClick(name) {
    if (ACTIONS[name].confirm) setPending(name);
    else run(name);
  }

  const amount = formatINR(escrow.amount);

  return (
    <div className={`card callout${escrow.status === 'disputed' ? ' warn' : ''}`}>
      {note && <p className="muted" style={{ margin: 0 }}>{note}</p>}

      {pending ? (
        <>
          <p style={{ margin: '0 0 12px' }}><strong>{ACTIONS[pending].confirm(amount)}</strong></p>
          <div className="actions" style={{ marginTop: 0 }}>
            <button className="btn primary" type="button" disabled={busy !== null} onClick={() => run(pending)}>
              {busy ? 'Working…' : `Yes, ${ACTIONS[pending].label.toLowerCase()}`}
            </button>
            <button className="btn" type="button" disabled={busy !== null} onClick={() => setPending(null)}>Cancel</button>
          </div>
        </>
      ) : (
        buttons.length > 0 && (
          <div className="actions" style={{ marginTop: note ? 12 : 0 }}>
            {buttons.map((name, i) => (
              <button
                key={name}
                className={`btn${i === 0 ? ' primary' : ''}`}
                type="button"
                disabled={busy !== null}
                onClick={() => onClick(name)}
              >
                {busy === name ? 'Working…' : ACTIONS[name].label}
                {ACTIONS[name].confirm && busy !== name ? ` · ${amount}` : ''}
              </button>
            ))}
          </div>
        )
      )}

      {message && (
        <p className={message.kind === 'ok' ? 'form-ok' : 'form-error'} role={message.kind === 'ok' ? 'status' : 'alert'} style={{ marginTop: 12 }}>
          {message.text}
        </p>
      )}
    </div>
  );
}

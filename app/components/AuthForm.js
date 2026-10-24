'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

// Shared form for /login and /register.
export default function AuthForm({ mode }) {
  const isRegister = mode === 'register';
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState('');
  const [fields, setFields] = useState({});
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFields({});

    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Something went wrong');
        setFields(json.fields || {});
        setBusy(false);
        return;
      }
      const next = params.get('next');
      // Only follow same-site paths, never a full URL from the query string.
      const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
      router.replace(safeNext || (json.user.role === 'admin' ? '/admin' : '/dashboard'));
      router.refresh();
    } catch {
      setError('Could not reach the server');
      setBusy(false);
    }
  }

  return (
    <main className="narrow">
      <h1>{isRegister ? 'Create your account' : 'Log in'}</h1>
      <p className="muted">{isRegister ? 'Get a PayTrust wallet in a minute.' : 'Welcome back to PayTrust.'}</p>

      <form className="card form" onSubmit={onSubmit} noValidate>
        {isRegister && (
          <Field label="Full name" name="full_name" autoComplete="name" error={fields.full_name} />
        )}
        <Field label="Email" name="email" type="email" autoComplete="email" error={fields.email} />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={isRegister ? 'new-password' : 'current-password'}
          hint={isRegister ? 'At least 8 characters' : undefined}
          error={fields.password}
        />

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Log in'}
        </button>
      </form>

      <p className="muted center">
        {isRegister ? (
          <>Already have an account? <Link href="/login">Log in</Link></>
        ) : (
          <>New here? <Link href="/register">Create an account</Link></>
        )}
      </p>
    </main>
  );
}

function Field({ label, name, type = 'text', autoComplete, hint, error }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input name={name} type={type} autoComplete={autoComplete} aria-invalid={!!error} required />
      {error ? <small className="bad">{error}</small> : hint ? <small className="muted">{hint}</small> : null}
    </label>
  );
}

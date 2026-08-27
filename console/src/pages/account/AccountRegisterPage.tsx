// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { accountAuth, type AccountSummary } from '../../api/accountAuth';
import { AccountAuthHero } from './AccountAuthHero';

export function AccountRegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [account, setAccount] = useState<AccountSummary | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Use a password with at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords don\u2019t match.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await accountAuth.register(email, password);
      sessionStorage.setItem('helixid.account.session', JSON.stringify(result));
      setAccount(result.account);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your account.');
    } finally {
      setSubmitting(false);
    }
  };

  if (account) {
    return (
      <div className="account-auth">
        <AccountAuthHero
          eyebrow="Account created"
          headline="Your identity is live."
          subhead="HelixID generated and encrypted a signing key for you, and published its DID document."
        />
        <div className="account-auth__panel">
          <div className="account-auth__card card" style={{ padding: 28 }}>
            <h1>You&rsquo;re all set</h1>
            <p className="account-auth__lede">Signed in as {account.email}.</p>
            <div className="did-seal" style={{ background: 'var(--surface-2)', border: '1px solid var(--hairline)' }}>
              <div className="did-seal__row">
                <span className="did-seal__label" style={{ color: 'var(--ink-muted)' }}>
                  Your issuer DID
                </span>
              </div>
              <div className="did-seal__value" style={{ color: 'var(--ink)' }}>
                {account.issuerDid}
              </div>
            </div>
            <button
              type="button"
              className="btn-primary"
              style={{ marginTop: 20, width: '100%', padding: '11px 15px' }}
              onClick={() => navigate('/agents')}
            >
              Continue to console
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="account-auth">
      <AccountAuthHero
        eyebrow="Hosted by HelixID"
        headline="Every account gets its own identity."
        subhead="Register and HelixID provisions a did:web issuer DID for you automatically \u2014 no keys to manage, no setup."
      />
      <div className="account-auth__panel">
        <div className="account-auth__card">
          <h1>Create your account</h1>
          <p className="account-auth__lede">Free to use, hosted on HelixID&rsquo;s public instance.</p>

          <form className="account-auth__form" onSubmit={handleSubmit}>
            <label>
              Email
              <input
                type="email"
                autoFocus
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            {error && <p className="account-auth__error" role="alert">{error}</p>}
            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Creating account\u2026' : 'Create account'}
            </button>
          </form>

          <div className="account-auth__divider">or</div>

          <a className="account-auth__google" href={accountAuth.googleSignInUrl()}>
            <GoogleGlyph />
            Continue with Google
          </a>

          <p className="account-auth__switch">
            Already have an account? <Link to="/account/login">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.87 2.7-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.98v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.98A9 9 0 0 0 0 9c0 1.45.35 2.83.98 4.03z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .98 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
  );
}

// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Signature element shared by the register/sign-in pages: a live-typed
// preview of the did:web document HelixID auto-provisions for every new
// account. Grounded in real backend behaviour (see
// docs/proposal-hosted-instance.md, "DID auto-provisioning") rather than
// decorative.

import { useEffect, useState } from 'react';
import helixMark from '../../assets/helix-mark.png';

const DID_TEMPLATE = 'did:web:hosted.helixid.io:accounts:8f2a1c9e';

export function AccountAuthHero({
  eyebrow,
  headline,
  subhead,
}: {
  eyebrow: string;
  headline: string;
  subhead: string;
}) {
  const [typed, setTyped] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion) {
      setTyped(DID_TEMPLATE);
      setDone(true);
      return;
    }
    let i = 0;
    const interval = window.setInterval(() => {
      i += 1;
      setTyped(DID_TEMPLATE.slice(0, i));
      if (i >= DID_TEMPLATE.length) {
        window.clearInterval(interval);
        setDone(true);
      }
    }, 38);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <div className="account-auth__hero">
      <div className="account-auth__brand">
        <img src={helixMark} alt="" />
        <span className="account-auth__word">
          HELIX<span className="accent">ID</span>
        </span>
      </div>

      <div className="account-auth__copy">
        <div className="account-auth__eyebrow">{eyebrow}</div>
        <h1 className="account-auth__headline">{headline}</h1>
        <p className="account-auth__subhead">{subhead}</p>

        <div className="did-seal" aria-hidden="true">
          <div className="did-seal__row">
            <span className="did-seal__ring" />
            <span className="did-seal__label">Issuer DID</span>
          </div>
          <div className="did-seal__value">
            {typed}
            {!done && <span className="did-seal__cursor" />}
          </div>
          <div className="did-seal__foot">
            Ed25519 keypair generated and encrypted server-side. You never see or handle it.
          </div>
        </div>
      </div>

      <p className="account-auth__footnote">
        Self-hosted, except we did the hosting for you — same open identity stack either way.
      </p>
    </div>
  );
}

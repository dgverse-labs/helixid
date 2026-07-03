// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useCallback, useState } from 'react';
import { api } from '../api/client';
import type { EnrollmentTokenInput, EnrollmentTokenResult } from '../api/types';
import { EnrollForm } from '../components/enroll/EnrollForm';
import { EnrollmentStatus } from '../components/enroll/EnrollmentStatus';

interface MintedToken extends EnrollmentTokenResult {
  createdAt: string;
}

export function EnrollPage() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<MintedToken | null>(null);

  const handleSubmit = useCallback((input: EnrollmentTokenInput) => {
    setSubmitting(true);
    setError(null);
    api
      .createEnrollmentToken(input)
      .then((result) => {
        setMinted({ ...result, createdAt: new Date().toISOString() });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to mint enrollment token');
      })
      .finally(() => setSubmitting(false));
  }, []);

  return (
    <div className="enroll-page">
      <h1>Enroll an agent</h1>

      {minted === null ? (
        <>
          {error && <p role="alert">{error}</p>}
          <EnrollForm onSubmit={handleSubmit} submitting={submitting} />
        </>
      ) : (
        <div className="minted-token">
          <h2>Enrollment token</h2>
          <p>
            Hand this to the agent; it expires at {minted.expiresAt}.
          </p>
          <code className="token-value">{minted.token}</code>
          <EnrollmentStatus tokenCreatedAt={minted.createdAt} />
          <button type="button" onClick={() => setMinted(null)}>
            Mint another token
          </button>
        </div>
      )}
    </div>
  );
}

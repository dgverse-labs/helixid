// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useState, type FormEvent } from 'react';
import type { EnrollmentTokenInput } from '../../api/types';

export interface EnrollFormProps {
  onSubmit: (input: EnrollmentTokenInput) => void;
  submitting: boolean;
}

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function EnrollForm({ onSubmit, submitting }: EnrollFormProps) {
  const [agentName, setAgentName] = useState('');
  const [scopes, setScopes] = useState('');
  const [domains, setDomains] = useState('');
  const [maxDelegationDepth, setMaxDelegationDepth] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const requestedDomains = splitList(domains);
    const depth = maxDelegationDepth.trim() === '' ? undefined : Number(maxDelegationDepth);
    onSubmit({
      agentName: agentName.trim(),
      requestedScopes: splitList(scopes),
      ...(requestedDomains.length > 0 ? { requestedDomains } : {}),
      ...(depth !== undefined && !Number.isNaN(depth) ? { maxDelegationDepth: depth } : {}),
    });
  };

  return (
    <form className="enroll-form" onSubmit={handleSubmit}>
      <label>
        Agent name
        <input
          required
          value={agentName}
          onChange={(event) => setAgentName(event.target.value)}
        />
      </label>
      <label>
        Requested scopes (comma or newline separated)
        <textarea
          required
          value={scopes}
          onChange={(event) => setScopes(event.target.value)}
          placeholder="read:orders, write:invoices"
        />
      </label>
      <label>
        Domains (optional)
        <input
          value={domains}
          onChange={(event) => setDomains(event.target.value)}
          placeholder="example.com"
        />
      </label>
      <label>
        Max delegation depth (optional)
        <input
          type="number"
          min="0"
          value={maxDelegationDepth}
          onChange={(event) => setMaxDelegationDepth(event.target.value)}
        />
      </label>
      <button type="submit" disabled={submitting}>
        {submitting ? 'Minting…' : 'Mint enrollment token'}
      </button>
    </form>
  );
}

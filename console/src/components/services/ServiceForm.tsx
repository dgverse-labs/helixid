// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useState, type FormEvent } from 'react';
import type { ServiceInput } from '../../api/types';

export interface ServiceFormProps {
  onSubmit: (input: ServiceInput) => void;
  submitting: boolean;
}

export function ServiceForm({ onSubmit, submitting }: ServiceFormProps) {
  const [serviceName, setServiceName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [verifiedDomain, setVerifiedDomain] = useState('');
  const [publicKeyMultibase, setPublicKeyMultibase] = useState('');
  const [apiEndpoint, setApiEndpoint] = useState('');
  const [metadata, setMetadata] = useState('');
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    let parsedMetadata: Record<string, unknown> | undefined;
    if (metadata.trim() !== '') {
      try {
        parsedMetadata = JSON.parse(metadata) as Record<string, unknown>;
      } catch {
        setMetadataError('Metadata must be valid JSON');
        return;
      }
    }
    setMetadataError(null);
    onSubmit({
      serviceName: serviceName.trim(),
      displayName: displayName.trim(),
      verifiedDomain: verifiedDomain.trim(),
      publicKeyMultibase: publicKeyMultibase.trim(),
      apiEndpoint: apiEndpoint.trim(),
      ...(parsedMetadata ? { metadata: parsedMetadata } : {}),
    });
  };

  return (
    <form className="service-form" onSubmit={handleSubmit}>
      <label>
        Service name
        <input required value={serviceName} onChange={(e) => setServiceName(e.target.value)} />
      </label>
      <label>
        Display name
        <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label>
        Verified domain
        <input
          required
          value={verifiedDomain}
          onChange={(e) => setVerifiedDomain(e.target.value)}
        />
      </label>
      <label>
        Public key (multibase)
        <input
          required
          value={publicKeyMultibase}
          onChange={(e) => setPublicKeyMultibase(e.target.value)}
        />
      </label>
      <label>
        API endpoint
        <input required value={apiEndpoint} onChange={(e) => setApiEndpoint(e.target.value)} />
      </label>
      <label>
        Metadata (optional JSON)
        <textarea value={metadata} onChange={(e) => setMetadata(e.target.value)} />
      </label>
      {metadataError && <p role="alert">{metadataError}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? 'Registering…' : 'Register service'}
      </button>
    </form>
  );
}

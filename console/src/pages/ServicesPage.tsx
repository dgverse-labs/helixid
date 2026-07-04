// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ServiceInput, ServiceRecord } from '../api/types';
import { ServiceList } from '../components/services/ServiceList';
import { ServiceForm } from '../components/services/ServiceForm';

export function ServicesPage() {
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const loadServices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listServices();
      setServices(result as ServiceRecord[]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load services');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const handleRegister = useCallback(
    (input: ServiceInput) => {
      setSubmitting(true);
      api
        .registerService(input)
        .then(async () => {
          setToast(`Registered ${input.serviceName}`);
          await loadServices();
        })
        .catch((err: unknown) => {
          setToast(err instanceof Error ? err.message : 'Service registration failed');
        })
        .finally(() => setSubmitting(false));
    },
    [loadServices],
  );

  return (
    <div className="services-page">
      <div className="page-header">
        <div>
          <h1>Services</h1>
          <p className="page-subtitle">
            Registered verifier services that accept presentations from your agents.
          </p>
        </div>
        <button type="button" onClick={() => void loadServices()}>
          Refresh
        </button>
      </div>

      {toast && (
        <p role="status" className="toast">
          {toast}{' '}
          <button type="button" onClick={() => setToast(null)}>
            Dismiss
          </button>
        </p>
      )}

      {loading && <p className="loading-note">Loading services…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && (
        <div className="card table-card">
          <ServiceList services={services} />
        </div>
      )}

      <div className="card form-card" style={{ marginTop: 22 }}>
        <h2>Register a service</h2>
        <ServiceForm onSubmit={handleRegister} submitting={submitting} />
      </div>
    </div>
  );
}

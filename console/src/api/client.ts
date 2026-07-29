// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { getApiConfig } from '../runtimeConfig';
import type {
  AuditFilters,
  AuditLogEntry,
  EnrollmentTokenInput,
  EnrollmentTokenResult,
  VcFilters,
  VCSummary,
  VCResponse,
} from './types';

const { apiBaseUrl, adminApiKey } = getApiConfig();

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path, apiBaseUrl || window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function requestJson<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
    expectJsonArray?: boolean;
  } = {},
): Promise<T> {
  const headers = new Headers();
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (adminApiKey) headers.set('x-admin-api-key', adminApiKey);

  const requestInit: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };
  if (options.body !== undefined) {
    requestInit.body = JSON.stringify(options.body);
  }

  const response = await fetch(buildUrl(path, options.query), requestInit);

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      // Ignore non-JSON error payloads.
    }
    throw new Error(message);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const payload = (await response.json()) as T;
  if (options.expectJsonArray && !Array.isArray(payload)) {
    throw new Error('Unexpected response shape');
  }
  return payload;
}

export const api = {
  listAgents: async (filters?: VcFilters): Promise<VCSummary[]> =>
    filters
      ? requestJson<VCSummary[]>('/v1/vcs', { query: { ...filters } })
      : requestJson<VCSummary[]>('/v1/vcs'),
  getAgent: async (vcId: string): Promise<VCResponse> =>
    requestJson<VCResponse>(`/v1/vcs/${encodeURIComponent(vcId)}`),
  revokeAgent: async (vcId: string): Promise<{ vcId: string; revoked: true; revokedAt: string }> =>
    requestJson(`/v1/vcs/${encodeURIComponent(vcId)}/revoke`, { method: 'POST' }),
  createEnrollmentToken: async (input: EnrollmentTokenInput): Promise<EnrollmentTokenResult> =>
    requestJson<EnrollmentTokenResult>('/v1/enrollment-tokens', {
      method: 'POST',
      body: input,
    }),
  getAuditLog: async (filters?: AuditFilters): Promise<AuditLogEntry[]> =>
    filters
      ? requestJson<AuditLogEntry[]>('/v1/audit-log', { query: { ...filters } })
      : requestJson<AuditLogEntry[]>('/v1/audit-log'),
};

export type Api = typeof api;

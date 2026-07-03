// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { HelixClient } from '@helixid/sdk-js';
import type {
  AuditFilters,
  EnrollmentTokenInput,
  ServiceInput,
  VcFilters,
} from './types';

interface HelixRuntimeConfig {
  API_BASE_URL?: string;
  ADMIN_API_KEY?: string;
}

declare global {
  interface Window {
    __HELIXID_CONFIG__?: HelixRuntimeConfig;
  }
}

/**
 * The only place in the app that reads configuration (dev spec §6).
 *
 * In containers, window.__HELIXID_CONFIG__ is populated by env-config.js,
 * generated from the container's environment at startup — the same
 * pre-built image runs with different ADMIN_API_KEY / API_BASE_URL per
 * environment, so this cannot be a build-time Vite variable. The
 * import.meta.env fallback exists only for local `npm run dev`.
 *
 * API_BASE_URL must be reachable from the operator's browser (the browser
 * makes the calls), not the compose-internal DNS name.
 */
function readConfig(): { apiBaseUrl: string; adminApiKey: string } {
  const runtime = typeof window === 'undefined' ? undefined : window.__HELIXID_CONFIG__;
  return {
    apiBaseUrl:
      runtime?.API_BASE_URL ?? (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '',
    adminApiKey:
      runtime?.ADMIN_API_KEY ?? (import.meta.env.VITE_ADMIN_API_KEY as string | undefined) ?? '',
  };
}

const { apiBaseUrl, adminApiKey } = readConfig();

// The admin key is attached here, once, for every call the client makes.
// OPEN ITEM (dev spec §5.3): whether POST /v1/services requires
// x-admin-api-key is undecided (service registry Option A). Because the
// key travels with every request from this one seam, resolving that
// decision needs no component changes — at most an adjustment here.
const client = new HelixClient(apiBaseUrl, { adminApiKey });

export const api = {
  listAgents: (filters?: VcFilters) => client.listVCs(filters),
  getAgent: (vcId: string) => client.getVC(vcId),
  revokeAgent: (vcId: string) => client.revokeVC(vcId),
  listServices: () => client.listServices(),
  registerService: (input: ServiceInput) => client.registerService(input),
  createEnrollmentToken: (input: EnrollmentTokenInput) => client.createEnrollmentToken(input),
  getAuditLog: (filters?: AuditFilters) => client.getAuditLog(filters),
};

export type Api = typeof api;

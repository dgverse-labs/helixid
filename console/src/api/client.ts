// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { HelixClient } from '@helixid/sdk-js';
import { getApiConfig } from '../runtimeConfig';
import type {
  AuditFilters,
  EnrollmentTokenInput,
  ServiceInput,
  VcFilters,
} from './types';

// Runtime config comes from the single seam in runtimeConfig.ts (dev
// spec §6): window.__HELIXID_CONFIG__ in containers, VITE_* only for local
// dev. This module owns the HelixClient wiring; components import `api`.
const { apiBaseUrl, adminApiKey } = getApiConfig();

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

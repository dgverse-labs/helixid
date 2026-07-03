// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

export type {
  AuditFilters,
  AuditLogEntry,
  EnrollmentTokenInput,
  EnrollmentTokenResult,
  ServiceInput,
  VcFilters,
  VCResponse,
  VCSummary,
} from '@helixid/sdk-js';

export type VCStatus = 'active' | 'revoked' | 'expired';

/** Shape of rows returned by GET /v1/services. */
export interface ServiceRecord {
  serviceName: string;
  displayName?: string;
  verifiedDomain?: string;
  apiEndpoint?: string;
  [key: string]: unknown;
}

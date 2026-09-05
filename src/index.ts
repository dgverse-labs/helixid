// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Package barrel for @helixid/core. A downstream product (self-hosted OSS
// server, or a hosted/enterprise build layering accounts/multi-tenancy on
// top) imports everything it needs from here — never from sub-paths, so
// this file is the actual, enforced surface of the package.

export * from './core/index.js';

export { errorHandler } from './middleware/errorHandler.js';
export { registerRequestLogger } from './middleware/requestLogger.js';

export { ApiAuditLogger } from './audit/index.js';

export type { ICache } from './cache/ICache.js';
export { NoopCache } from './cache/NoopCache.js';
export { InProcessCache } from './cache/InProcessCache.js';
export { RedisCache, type RedisLike } from './cache/RedisCache.js';
export { TwoLayerCache } from './cache/TwoLayerCache.js';
export { createDidCache, createStatusListCache } from './cache/cacheFactory.js';

export { createHederaClient } from './hedera/createHederaClient.js';
export type { IHederaClient } from './hedera/IHederaClient.js';
export { DisabledHederaClient } from './hedera/DisabledHederaClient.js';
export { MockHederaClient } from './hedera/mock/MockHederaClient.js';

export { SqliteStore, sqliteLiteral } from './storage/sqlite.js';
export {
  UnsupportedStorageDriverError,
  type StorageDriverDeps,
  type StorageDriverKind,
} from './storage/driver-registry.js';

export { DidRepository } from './repositories/did.repository.js';
export { VcRepository } from './repositories/vc.repository.js';
export type {
  VCRecord,
  ListVcFilters,
  CreateVcParams,
  StatusListEntryRecord,
} from './repositories/vc.repository.js';
export { VPRepository } from './repositories/vp.repository.js';
export { AuditLogRepository } from './repositories/audit-log.repository.js';
export type { AuditLogRecord, ListAuditLogFilters } from './repositories/audit-log.repository.js';
export { AgentRepository } from './repositories/agent.repository.js';
export type {
  EnrollmentTokenRecord,
  ChallengeRecord,
  ServiceRegistryRecord,
} from './repositories/agent.repository.js';
export { ServiceRegistryRepository } from './repositories/service-registry.repository.js';
export { PreparedPayloadRepository } from './repositories/prepared-payload.repository.js';

export { DIDService } from './services/did/did.service.js';
export type { IDIDService } from './services/did/did.service.js';
export { extractEd25519PublicKeyHexFromDIDDocument } from './services/did/publicKey.js';
export { VCService } from './services/vc/vc.service.js';
export type {
  IVCService,
  IssueVCParams,
  IssueVCResult,
  VCDetails,
  ListVCFilters,
  VCSummary,
  RenewVCOptions,
} from './services/vc/vc.service.js';
export { VPService } from './services/vp/vp.service.js';
export type { IVPService } from './services/vp/IVPService.js';
export { AgentService, mapAgentError, hashToken } from './services/agent/agent.service.js';
export type {
  IAgentService,
  EnrollmentTokenResult,
  ChallengeResult,
  OnboardVerifyResult,
  EnrollResult,
  UserChallengeVerifyResult,
} from './services/agent/IAgentService.js';
export { PreparedPayloadService } from './services/prepared-payload/index.js';
export type { IPreparedPayloadService } from './services/prepared-payload/IPreparedPayloadService.js';

export { default as didRoutes } from './routes/did/index.js';
export { default as didWebRoutes } from './routes/did-web/index.js';
export { default as vcRoutes, type VcRouteOptions } from './routes/vc/index.js';
export { default as statusListRoutes } from './routes/status-list/index.js';
export { default as vpRoutes } from './routes/vp/index.js';
export { default as agentRoutes } from './routes/agent/index.js';
export { default as auditLogRoutes } from './routes/audit-log/index.js';
export { default as sessionRoutes } from './routes/sessions/index.js';
export { default as preparedPayloadRoutes } from './routes/prepared-payload/index.js';

// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0
import './loadEnv.js';
import crypto from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import pg from 'pg';
import { Redis } from 'ioredis';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import {
  buildDIDDocument,
  derivePublicKey,
  generateKeyPair,
  loadConfigFromEnv,
  resolveDidMethod,
  type DIDDocument,
} from '@helixid/core';

import { errorHandler } from './middleware/errorHandler.js';
import { ApiAuditLogger } from './audit/index.js';
import { createHederaClient } from './hedera/createHederaClient.js';
import { DidRepository } from './repositories/did.repository.js';
import { VcRepository } from './repositories/vc.repository.js';
import { VPRepository } from './repositories/vp.repository.js';
import { AgentRepository } from './repositories/agent.repository.js';
import { AuditLogRepository } from './repositories/audit-log.repository.js';
import { ServiceRegistryRepository } from './repositories/service-registry.repository.js';
import { createDidCache, createStatusListCache } from './cache/cacheFactory.js';
import { extractEd25519PublicKeyHexFromDIDDocument } from './services/did/publicKey.js';
import { DIDService } from './services/did/did.service.js';
import { VCService } from './services/vc/vc.service.js';
import { VPService } from './services/vp/vp.service.js';
import { AgentService } from './services/agent/agent.service.js';
import didRoutes from './routes/did/index.js';
import didWebRoutes from './routes/did-web/index.js';
import vcRoutes from './routes/vc/index.js';
import statusListRoutes from './routes/status-list/index.js';
import vpRoutes from './routes/vp/index.js';
import agentRoutes from './routes/agent/index.js';
import auditRoutes from './routes/audit/index.js';
import sessionRoutes from './routes/sessions/index.js';
import type { RedisLike } from './cache/RedisCache.js';
import { SqliteStore } from './storage/sqlite.js';

const config = loadConfigFromEnv();
const storageAdapter =
  (config as unknown as { HELIX_STORAGE_ADAPTER?: 'sqlite' | 'postgres' }).HELIX_STORAGE_ADAPTER ??
  'sqlite';
const cacheAdapter =
  (config as unknown as { HELIX_CACHE_ADAPTER?: 'memory' | 'redis' }).HELIX_CACHE_ADAPTER ??
  'memory';
const usingPostgres = storageAdapter === 'postgres';
const usingSqlite = storageAdapter === 'sqlite';
const apiPackageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configuredSqlitePath =
  (config as unknown as { HELIX_SQLITE_PATH?: string }).HELIX_SQLITE_PATH ?? 'data/helixid.sqlite';
const sqlitePath = isAbsolute(configuredSqlitePath)
  ? configuredSqlitePath
  : resolve(apiPackageDir, configuredSqlitePath);
const databaseName = getDatabaseName(config.DATABASE_URL);

if (usingPostgres && config.NODE_ENV !== 'test' && /test/i.test(databaseName)) {
  throw new Error(
    `Refusing to start ${config.NODE_ENV} API against test database '${databaseName}'. ` +
      'Set DATABASE_URL to the working database or run with NODE_ENV=test intentionally.',
  );
}

const pool = usingPostgres ? new pg.Pool({ connectionString: config.DATABASE_URL }) : null;
const adapter = pool ? new PrismaPg(pool) : null;
const prisma = adapter ? new PrismaClient({ adapter }) : undefined;
const sqlite = usingSqlite ? new SqliteStore(sqlitePath) : undefined;

const redis: RedisLike | null =
  cacheAdapter === 'redis' && config.CACHE_L2_ENABLED && config.REDIS_URL
    ? new Redis(config.REDIS_URL)
    : null;

const auditLogger = new ApiAuditLogger(prisma, config, sqlite);
const didRepository = new DidRepository(prisma, sqlite);
const vcRepository = new VcRepository(prisma, sqlite);
const vpRepository = new VPRepository(prisma, sqlite);
const agentRepository = new AgentRepository(prisma, sqlite);
const serviceRegistry = new ServiceRegistryRepository();
const auditLogRepository = new AuditLogRepository(prisma, sqlite);

await ensureIssuerDidCached();

const didMethod = resolveDidMethod(process.env);
const hederaClient = await createHederaClient(config);
const didCache = createDidCache<DIDDocument>(config, redis);
const statusListCache = createStatusListCache<string>(config, redis);
const jwtSessionKeyPair = generateKeyPair();

const didService = new DIDService(
  didRepository,
  hederaClient,
  auditLogger,
  didCache,
  config.DID_CACHE_L1_TTL_SECONDS,
);
const vcService = new VCService(
  vcRepository,
  didService,
  auditLogger,
  config.HELIX_SIGNING_KEY,
  config.HELIX_ISSUER_DID,
  config.API_BASE_URL,
  statusListCache,
  config.STATUS_LIST_CACHE_L1_TTL_SECONDS,
);
const vpService = new VPService(
  vpRepository,
  didService,
  vcService,
  serviceRegistry,
  auditLogger,
  config.VP_TTL_SECONDS,
  {
    signingKey: jwtSessionKeyPair.privateKey,
    issuerDid: config.HELIX_ISSUER_DID,
    ttlSeconds: config.JWT_SESSION_TTL_SECONDS,
  },
);
const agentService = new AgentService(agentRepository, didService, vcService, auditLogger);

const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.body.privateKey', 'req.body.privateKeyHex'],
  },
  genReqId: () => `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
});


app.addSchema({
  $id: 'Error',
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
      },
    },
  },
});
app.addSchema({ $id: 'BadRequest', type: 'object', $ref: 'Error#' });
app.addSchema({ $id: 'NotFound', type: 'object', $ref: 'Error#' });
app.addSchema({ $id: 'Conflict', type: 'object', $ref: 'Error#' });

app.setErrorHandler(errorHandler);

app.get('/health', async () => ({
  status: 'ok',
  version: '0.1.0',
  environment: config.NODE_ENV,
  storageAdapter,
  database: usingPostgres ? databaseName : usingSqlite ? sqlitePath : 'disabled',
  cacheAdapter,
}));

function getDatabaseName(databaseUrl: string | undefined): string {
  if (!databaseUrl) return 'none';
  try {
    return new URL(databaseUrl).pathname.replace(/^\//, '');
  } catch {
    return 'unknown';
  }
}

async function ensureIssuerDidCached(): Promise<void> {
  const expectedPublicKey = derivePublicKey(config.HELIX_SIGNING_KEY).toLowerCase();
  const existing = await didRepository.findDidById(config.HELIX_ISSUER_DID);
  if (existing) {
    const existingPublicKey = extractEd25519PublicKeyHexFromDIDDocument(existing.didDocument);
    if (existingPublicKey !== expectedPublicKey) {
      throw new Error(
        'Configured issuer DID public key does not match HELIX_SIGNING_KEY. ' +
          'Run setup with matching issuer material or fix HELIX_ISSUER_DID before issuing VCs.',
      );
    }
    return;
  }

  const didDocument = buildDIDDocument(config.HELIX_ISSUER_DID, expectedPublicKey);
  await didRepository.createDid({
    id: config.HELIX_ISSUER_DID,
    subjectType: 'user',
    controller: config.HELIX_ISSUER_DID,
    publicKey: expectedPublicKey,
    publicKeyMultibase: didDocument.verificationMethod[0]!.publicKeyMultibase,
    hederaTransactionId: `configured-issuer:${config.HELIX_ISSUER_DID}`,
    didDocument,
  });
}

await app.register(didRoutes, { didService });
await app.register(didWebRoutes, { issuerDid: config.HELIX_ISSUER_DID, didRepository });
await app.register(vcRoutes, {
  prefix: '/v1/vcs',
  vcService,
  adminApiKey: config.HELIX_ADMIN_API_KEY,
});
await app.register(statusListRoutes, { prefix: '/v1/status-list', vcService });
await app.register(vpRoutes, { prefix: '/v1/vp', vpService });
await app.register(sessionRoutes, {
  prefix: '/v1/sessions',
  publicKeyHex: jwtSessionKeyPair.publicKey,
});
await app.register(agentRoutes, { prefix: '/v1', agentService });
await app.register(auditRoutes, {
  prefix: '/v1/audit-log',
  auditLogRepository,
  adminApiKey: config.HELIX_ADMIN_API_KEY,
});

const shutdown = async (): Promise<void> => {
  app.log.info('Helix ID API shutting down...');
  await app.close();
  (redis as Redis | null)?.disconnect();
  await prisma?.$disconnect();
  await pool?.end();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();

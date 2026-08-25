// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0
import './loadEnv.js';
import crypto from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
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
import { AuditLogRepository } from './repositories/audit-log.repository.js';
import { AgentRepository } from './repositories/agent.repository.js';
import { ServiceRegistryRepository } from './repositories/service-registry.repository.js';
import { PreparedPayloadRepository } from './repositories/prepared-payload.repository.js';
import { AccountRepository } from './repositories/account.repository.js';
import { IssuerKeyRepository } from './repositories/issuer-key.repository.js';
import { RefreshTokenRepository } from './repositories/refresh-token.repository.js';
import { createDidCache, createStatusListCache } from './cache/cacheFactory.js';
import { extractEd25519PublicKeyHexFromDIDDocument } from './services/did/publicKey.js';
import { DIDService } from './services/did/did.service.js';
import { VCService } from './services/vc/vc.service.js';
import { VPService } from './services/vp/vp.service.js';
import { AgentService } from './services/agent/agent.service.js';
import { PreparedPayloadService } from './services/prepared-payload/index.js';
import { AuthService, AesGcmKeyCustody, ConsoleEmailSender } from './services/auth/index.js';
import didRoutes from './routes/did/index.js';
import didWebRoutes from './routes/did-web/index.js';
import vcRoutes from './routes/vc/index.js';
import statusListRoutes from './routes/status-list/index.js';
import vpRoutes from './routes/vp/index.js';
import agentRoutes from './routes/agent/index.js';
import auditLogRoutes from './routes/audit-log/index.js';
import sessionRoutes from './routes/sessions/index.js';
import preparedPayloadRoutes from './routes/prepared-payload/index.js';
import authRoutes from './routes/auth/index.js';
import accountDidRoutes from './routes/account-did/index.js';
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
const auditLogRepository = new AuditLogRepository(prisma, sqlite);
const agentRepository = new AgentRepository(prisma, sqlite);
const serviceRegistry = new ServiceRegistryRepository(agentRepository);
const preparedPayloadRepository = new PreparedPayloadRepository(prisma, sqlite);
const accountRepository = new AccountRepository(prisma, sqlite);
const issuerKeyRepository = new IssuerKeyRepository(prisma, sqlite);
const refreshTokenRepository = new RefreshTokenRepository(prisma, sqlite);
await serviceRegistry.seedBuiltIns();

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
const vpService = new VPService(vcService, auditLogger, config.API_BASE_URL, {
  signingKey: jwtSessionKeyPair.privateKey,
  issuerDid: config.HELIX_ISSUER_DID,
  ttlSeconds: config.JWT_SESSION_TTL_SECONDS,
});
const agentService = new AgentService(agentRepository, didService, vcService, auditLogger);
const preparedPayloadService = new PreparedPayloadService(preparedPayloadRepository, didService);

// Hosted accounts & auth (Item #1, see docs/proposal-hosted-instance.md).
// Both secrets fall back to a random per-process value when unset, so
// self-hosted / dev environments boot without configuring them — but that
// means encrypted IssuerKeyRecord rows and issued sessions won't survive a
// restart in that mode. Set HOSTED_KEY_ENCRYPTION_KEY / HOSTED_ACCESS_TOKEN_SECRET
// explicitly for any deployment that needs persistence across restarts.
const hostedKeyEncryptionKey =
  (config as unknown as { HOSTED_KEY_ENCRYPTION_KEY?: string }).HOSTED_KEY_ENCRYPTION_KEY ??
  crypto.randomBytes(32).toString('hex');
const hostedAccessTokenSecret =
  (config as unknown as { HOSTED_ACCESS_TOKEN_SECRET?: string }).HOSTED_ACCESS_TOKEN_SECRET ??
  crypto.randomBytes(32).toString('hex');
const hostedDidDomain =
  (config as unknown as { HOSTED_DID_DOMAIN?: string }).HOSTED_DID_DOMAIN ?? 'hosted.helixid.io';
const hostedAccessTokenTtlSeconds =
  (config as unknown as { HOSTED_ACCESS_TOKEN_TTL_SECONDS?: number }).HOSTED_ACCESS_TOKEN_TTL_SECONDS ??
  900;
const hostedRefreshTokenTtlDays =
  (config as unknown as { HOSTED_REFRESH_TOKEN_TTL_DAYS?: number }).HOSTED_REFRESH_TOKEN_TTL_DAYS ?? 30;
const keyCustody = new AesGcmKeyCustody(hostedKeyEncryptionKey);
const emailSender = new ConsoleEmailSender();
const hostedConsoleBaseUrl =
  (config as unknown as { HOSTED_CONSOLE_BASE_URL?: string }).HOSTED_CONSOLE_BASE_URL ??
  'https://hosted.helixid.io';
const hostedEmailVerificationTtlHours =
  (config as unknown as { HOSTED_EMAIL_VERIFICATION_TTL_HOURS?: number })
    .HOSTED_EMAIL_VERIFICATION_TTL_HOURS ?? 24;
const authService = new AuthService(
  accountRepository,
  didRepository,
  issuerKeyRepository,
  refreshTokenRepository,
  keyCustody,
  auditLogger,
  hostedAccessTokenSecret,
  hostedDidDomain,
  hostedAccessTokenTtlSeconds,
  hostedRefreshTokenTtlDays,
  emailSender,
  hostedConsoleBaseUrl,
  hostedEmailVerificationTtlHours,
);

const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.body.privateKey', 'req.body.privateKeyHex'],
  },
  genReqId: () => `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
});

// Per-IP rate limiting (proposal-hosted-rate-limiting.md, §1 — decided).
// Only applies in hosted mode: self-hosted single-operator deployments
// shouldn't have hosted-tier limits forced on them. Global ceiling here;
// tighter per-route overrides are set via `config.rateLimit` on the
// individual auth routes (see routes/auth/index.ts).
const isHostedMode = (config as unknown as { HOSTED_MODE?: boolean }).HOSTED_MODE ?? false;
const rateLimitGlobalMax =
  (config as unknown as { HOSTED_RATE_LIMIT_GLOBAL_MAX?: number }).HOSTED_RATE_LIMIT_GLOBAL_MAX ?? 100;
const rateLimitLoginMax =
  (config as unknown as { HOSTED_RATE_LIMIT_LOGIN_MAX?: number }).HOSTED_RATE_LIMIT_LOGIN_MAX ?? 5;
const rateLimitRegisterMax =
  (config as unknown as { HOSTED_RATE_LIMIT_REGISTER_MAX?: number }).HOSTED_RATE_LIMIT_REGISTER_MAX ?? 3;
const rateLimitRefreshMax =
  (config as unknown as { HOSTED_RATE_LIMIT_REFRESH_MAX?: number }).HOSTED_RATE_LIMIT_REFRESH_MAX ?? 20;

if (isHostedMode) {
  await app.register(rateLimit, {
    global: true,
    max: rateLimitGlobalMax,
    timeWindow: '1 minute',
  });
}


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
await app.register(preparedPayloadRoutes, {
  prefix: '/v1/vcs',
  preparedPayloadService,
});
await app.register(statusListRoutes, {
  prefix: '/v1/status-list',
  vcService,
  adminApiKey: config.HELIX_ADMIN_API_KEY,
});
await app.register(vpRoutes, { prefix: '/v1/vp', vpService });
await app.register(sessionRoutes, {
  prefix: '/v1/sessions',
  publicKeyHex: jwtSessionKeyPair.publicKey,
});
await app.register(auditLogRoutes, {
  prefix: '/v1/audit-log',
  auditLogRepository,
  auditLogger,
  adminApiKey: config.HELIX_ADMIN_API_KEY,
});
await app.register(agentRoutes, { prefix: '/v1', agentService });
await app.register(authRoutes, {
  prefix: '/v1/auth',
  authService,
  googleClientId: (config as unknown as { GOOGLE_CLIENT_ID?: string }).GOOGLE_CLIENT_ID,
  googleClientSecret: (config as unknown as { GOOGLE_CLIENT_SECRET?: string }).GOOGLE_CLIENT_SECRET,
  googleRedirectUri: (config as unknown as { GOOGLE_OAUTH_REDIRECT_URI?: string })
    .GOOGLE_OAUTH_REDIRECT_URI,
});
await app.register(accountDidRoutes, { didDomain: hostedDidDomain, didRepository });

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

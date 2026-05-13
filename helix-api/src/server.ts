// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0
import 'dotenv/config';
import crypto from 'node:crypto';
import Fastify from 'fastify';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from '@helix-id/core';

import { errorHandler } from './middleware/errorHandler.js';
import { ApiAuditLogger } from './audit/index.js';
import { MockHederaClient } from './hedera/mock/MockHederaClient.js';
import { HieroHederaClient } from './hedera/HieroHederaClient.js';
import { DidRepository } from './repositories/did.repository.js';
import { VcRepository } from './repositories/vc.repository.js';
import { VPRepository } from './repositories/vp.repository.js';
import { AgentRepository } from './repositories/agent.repository.js';
import { ServiceRegistryRepository } from './services/vp/ServiceRegistryRepository.js';
import { DIDService } from './services/did/did.service.js';
import { VCService } from './services/vc/vc.service.js';
import { VPService } from './services/vp/vp.service.js';
import { AgentService } from './services/agent/agent.service.js';
import didRoutes from './routes/did/index.js';
import vcRoutes from './routes/vc/index.js';
import statusListRoutes from './routes/status-list/index.js';
import vpRoutes from './routes/vp/index.js';
import agentRoutes from './routes/agent/index.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const auditLogger = new ApiAuditLogger(prisma);
const didRepository = new DidRepository(prisma);
const vcRepository = new VcRepository(prisma);
const vpRepository = new VPRepository();
const agentRepository = new AgentRepository();
const serviceRegistry = new ServiceRegistryRepository();

const hederaClient = config.NODE_ENV === 'test' || process.env['HEDERA_MOCK'] === 'true'
  ? new MockHederaClient()
  : new HieroHederaClient();

const didService = new DIDService(didRepository, hederaClient, auditLogger);
const vcService = new VCService(
  vcRepository,
  didService,
  auditLogger,
  config.HELIX_SIGNING_KEY,
  config.API_BASE_URL,
);
const vpService = new VPService(vpRepository, didService, vcService, serviceRegistry, auditLogger);
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
}));

await app.register(didRoutes, { didService });
await app.register(vcRoutes, { prefix: '/v1/vcs', vcService });
await app.register(statusListRoutes, { prefix: '/v1/status-list', vcService });
await app.register(vpRoutes, { prefix: '/v1/vp', vpService });
await app.register(agentRoutes, { prefix: '/v1', agentService });

const shutdown = async (): Promise<void> => {
  app.log.info('Helix ID API shutting down...');
  await app.close();
  await prisma.$disconnect();
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

import Fastify from 'fastify';
import vpRoutes from './routes/vp/index.js';
import agentRoutes from './routes/agent/index.js';
import didRoutes from './routes/did/index.js';
import vcRoutes from './routes/vc/index.js';
import { VPRepository } from './repositories/vp.repository.js';
import { AgentRepository } from './repositories/agent.repository.js';
import { DIDRepository } from './repositories/did.repository.js';
import { VCRepository } from './repositories/vc.repository.js';
import { ServiceRegistryRepository } from './services/vp/ServiceRegistryRepository.js';
import { VPService } from './services/vp/vp.service.js';
import { AgentService } from './services/agent/agent.service.js';
import { DIDService } from './services/did/did.service.js';
import { MockHederaClient } from './hedera/mock/MockHederaClient.js';
import { PrismaVCService } from './services/vc/PrismaVCService.js';
import { ApiAuditLogger } from './audit/index.js';
import { prisma } from './repositories/did.repository.js';

const app = Fastify({
  logger: true,
  genReqId: () => `req_${crypto.randomUUID()}`,
});

const didRepo = new DIDRepository();
const vcRepo = new VCRepository();
const vpRepo = new VPRepository();
const agentRepo = new AgentRepository();
const serviceRepo = new ServiceRegistryRepository();
const auditLogger = new ApiAuditLogger(prisma);

// B1: Hedera client — use mock in development; swap to HederaHIEROClient in production
const hederaClient = new MockHederaClient();

const didService = new DIDService(didRepo, hederaClient, auditLogger);
const vcService = new PrismaVCService(vcRepo, didService, auditLogger);

const vpService = new VPService(
  vpRepo,
  didService,
  vcService,
  serviceRepo,
  auditLogger
);

const agentService = new AgentService(
  agentRepo,
  didService,
  vcService,
  auditLogger
);

app.get('/health', async () => ({ status: 'ok', version: '0.1.0' }));

// B1 — DID routes
await app.register(didRoutes, { prefix: '/v1/dids', didService });

// B3 — VP routes
await app.register(vpRoutes, { prefix: '/v1/vp', vpService });

// B4 — Agent routes
await app.register(agentRoutes, { prefix: '/v1', agentService });

// B2 — VC routes
await app.register(vcRoutes, { prefix: '/v1', vcService });

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  await app.close();
  process.exit(0);
});
process.on('SIGINT', async () => {
  await app.close();
  process.exit(0);
});

start();

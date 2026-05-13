// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import Fastify from 'fastify';
import vpRoutes from './routes/vp/index.js';
import agentRoutes from './routes/agent/index.js';
import { VPRepository } from './repositories/vp.repository.js';
import { AgentRepository } from './repositories/agent.repository.js';
import { ServiceRegistryRepository } from './services/vp/ServiceRegistryRepository.js';
import { VPService } from './services/vp/vp.service.js';
import { AgentService } from './services/agent/agent.service.js';
import type { IAuditLogger } from '@helix-id/core';
import type { IDIDService } from './services/did/IDIDService.js';
import type { IVCService, IssueVCInput } from './services/vc/IVCService.js';

import { DIDRepository } from './repositories/did.repository.js';
import { VCRepository } from './repositories/vc.repository.js';
import { PrismaDIDService } from './services/did/PrismaDIDService.js';
import { PrismaVCService } from './services/vc/PrismaVCService.js';

class StdoutAuditLogger implements IAuditLogger {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  log(_event: import('@helix-id/core').AuditEvent, _payload: Record<string, unknown>): void {
    console.log(`[AUDIT] ${_event}:`, JSON.stringify(_payload));
  }
}

const app = Fastify({ logger: true });

const didRepo = new DIDRepository();
const vcRepo = new VCRepository();
const vpRepo = new VPRepository();
const agentRepo = new AgentRepository();
const serviceRepo = new ServiceRegistryRepository();
const auditLogger = new StdoutAuditLogger();

const didService = new PrismaDIDService(didRepo);
const vcService = new PrismaVCService(vcRepo);

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
await app.register(vpRoutes, { prefix: '/v1/vp', vpService });
await app.register(agentRoutes, { prefix: '/v1', agentService });

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: 3000, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
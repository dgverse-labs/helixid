// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
import 'dotenv/config';
import Fastify from 'fastify';
import crypto from 'node:crypto';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from '@helix-id/core';

import { DidRepository } from './repositories/did.repository.js';
import { VcRepository } from './repositories/vc.repository.js';
import { ApiAuditLogger } from './audit/index.js';
import { HieroHederaClient } from './hedera/HieroHederaClient.js';
import { MockHederaClient } from './hedera/mock/MockHederaClient.js';
import { DIDService } from './services/did/did.service.js';
import { VCService } from './services/vc/vc.service.js';

import { errorHandler } from './middleware/errorHandler.js';
import didRoutes from './routes/did/index.js';
import vcRoutes from './routes/vc/index.js';
import statusListRoutes from './routes/status-list/index.js';

import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

// --- Dependency Injection Setup ---
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const didRepository = new DidRepository(prisma);
const vcRepository = new VcRepository(prisma);
const auditLogger = new ApiAuditLogger(prisma);

// Choose Hedera client based on environment
const hederaClient = (config.NODE_ENV === 'test' || process.env['HEDERA_MOCK'] === 'true')
  ? new MockHederaClient()
  : new HieroHederaClient();

const didService = new DIDService(didRepository, hederaClient, auditLogger);
const vcService = new VCService(
  vcRepository,
  didService,
  auditLogger,
  config.HELIX_SIGNING_KEY,
  config.API_BASE_URL
);

// --- Fastify Instance ---
const app = Fastify({
  logger: {
    level: config.NODE_ENV === 'production' ? 'info' : 'debug',
    redact: ['req.headers.authorization', 'req.body.privateKey', 'req.body.privateKeyHex'],
  },
  disableRequestLogging: false,
  genReqId: () => `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`,
});

// --- Swagger Configuration ---
await app.register(fastifySwagger, {
  openapi: {
    info: {
      title: 'Helix ID API',
      description: 'Decentralized Identity API for the Helix Network',
      version: '0.1.0',
    },
    servers: [{ url: `http://localhost:${config.PORT}` }],
    components: {
      responses: {
        BadRequest: {
          description: 'Invalid request parameters',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        },
        NotFound: {
          description: 'The requested resource was not found',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        },
        Conflict: {
          description: 'Resource already exists',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        },
        InternalError: {
          description: 'Internal server error',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
        }
      },
      schemas: {
        Error: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message'],
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string', example: 'Invalid input' },
                requestId: { type: 'string', example: 'req-123' },
                details: { type: 'object', additionalProperties: true }
              }
            }
          }
        }
      }
    }
  }
});

await app.register(fastifySwaggerUi, {
  routePrefix: '/docs',
  uiConfig: {
    docExpansion: 'list',
    deepLinking: false
  },
});

// Decorate fastify with services
declare module 'fastify' {
  interface FastifyInstance {
    didService: DIDService;
  }
}
app.decorate('didService', didService);

// --- Shared Schemas ---
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
        details: { type: 'object', additionalProperties: true }
      }
    }
  }
});

app.addSchema({
  $id: 'BadRequest',
  description: 'Invalid request parameters',
  type: 'object',
  $ref: 'Error#'
});

app.addSchema({
  $id: 'NotFound',
  description: 'The requested resource was not found',
  type: 'object',
  $ref: 'Error#'
});

app.addSchema({
  $id: 'Conflict',
  description: 'Resource already exists',
  type: 'object',
  $ref: 'Error#'
});

// Register global error handler
app.setErrorHandler(errorHandler);

// --- Routes ---
app.get('/health', async () => ({
  status: 'ok',
  version: '0.1.0',
  environment: config.NODE_ENV
}));

app.register(didRoutes, { prefix: '/v1/dids', didService });
app.register(vcRoutes, { prefix: '/v1/vcs', vcService });
app.register(statusListRoutes, { prefix: '/v1/status-list', vcService });

// --- Graceful Shutdown ---
const shutdown = async () => {
  app.log.info('Helix ID API shutting down...');
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

const start = async (): Promise<void> => {
  try {
    const port = config.PORT;
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info(`Helix ID API booting on port ${port}...`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
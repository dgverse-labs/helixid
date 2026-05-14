/**
 * helix-api/src/routes/did/index.ts
 *
 * Fastify plugin for B1 DID & Hedera Integration routes.
 * See story1.md §1.10 for full specification.
 * AC-4: every route defines full JSON schema for body, params, querystring, response.
 */

import type { FastifyPluginAsync } from 'fastify';
import { HelixError, ErrorCodes } from '@helix-id/core';
import type { IDIDService } from '../../services/did/IDIDService.js';

const DID_PATTERN = String.raw`^did:hedera:testnet:[a-zA-Z0-9._\-]+(_\d+\.\d+\.\d+)?$`;
const ENDPOINT_ID_PATTERN = String.raw`^#[a-zA-Z0-9\-]+$`;
const PUBLIC_KEY_HEX_PATTERN = String.raw`^[0-9a-fA-F]{64}$`;

const errorResponseSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'requestId'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        requestId: { type: 'string' },
      },
    },
  },
};

const didDocumentSchema = {
  type: 'object',
  properties: {
    '@context': { type: 'array', items: { type: 'string' } },
    id: { type: 'string' },
    controller: { type: 'string' },
    verificationMethod: { type: 'array' },
    authentication: { type: 'array' },
    assertionMethod: { type: 'array' },
    service: { type: 'array' },
  },
};

interface DidRouteOptions {
  didService: IDIDService;
}

const didRoutes: FastifyPluginAsync<DidRouteOptions> = async (fastify, opts) => {
  const { didService } = opts;

  // ─── POST /v1/dids — Create DID ─────────────────────────────────────────────

  fastify.post<{
    Body: { publicKeyHex: string; subjectType: 'agent' | 'user'; domains?: string[] };
  }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['publicKeyHex', 'subjectType'],
          properties: {
            publicKeyHex: { type: 'string', pattern: PUBLIC_KEY_HEX_PATTERN },
            subjectType: { type: 'string', enum: ['agent', 'user'] },
            domains: {
              type: 'array',
              items: { type: 'string', pattern: '^https://' },
              maxItems: 10,
            },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              did: { type: 'string' },
              didDocument: didDocumentSchema,
              hederaTransactionId: { type: 'string' },
            },
          },
          400: errorResponseSchema,
          409: errorResponseSchema,
          502: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { publicKeyHex, subjectType, domains = [] } = request.body;
      const result = await didService.createDID(publicKeyHex, subjectType, domains, request.id);
      return reply.status(201).send(result);
    },
  );

  // ─── GET /v1/dids/:did — Resolve DID ────────────────────────────────────────

  fastify.get<{
    Params: { did: string };
    Querystring: { live?: string };
  }>(
    '/:did',
    {
      schema: {
        params: {
          type: 'object',
          required: ['did'],
          properties: {
            did: { type: 'string', pattern: DID_PATTERN },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            live: { type: 'string', enum: ['true', 'false'] },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              did: { type: 'string' },
              didDocument: didDocumentSchema,
              source: { type: 'string', enum: ['cache', 'hedera'] },
            },
          },
          400: errorResponseSchema,
          404: errorResponseSchema,
          410: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { did } = request.params;
      const live = request.query.live === 'true';
      const result = live
        ? await didService.resolveDIDFromHedera(did, request.id)
        : await didService.resolveDID(did, request.id);
      return reply.status(200).send(result);
    },
  );

  // ─── POST /v1/dids/:did/services — Add service endpoint ─────────────────────

  fastify.post<{
    Params: { did: string };
    Body: { id: string; type: string; serviceEndpoint: string };
  }>(
    '/:did/services',
    {
      schema: {
        params: {
          type: 'object',
          required: ['did'],
          properties: {
            did: { type: 'string', pattern: DID_PATTERN },
          },
        },
        body: {
          type: 'object',
          required: ['id', 'type', 'serviceEndpoint'],
          properties: {
            id: { type: 'string', pattern: ENDPOINT_ID_PATTERN },
            type: { type: 'string', enum: ['LinkedDomains'] },
            serviceEndpoint: { type: 'string', pattern: '^https://' },
          },
        },
        response: {
          200: { type: 'object', properties: { didDocument: didDocumentSchema } },
          400: errorResponseSchema,
          404: errorResponseSchema,
          409: errorResponseSchema,
          410: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { did } = request.params;
      const endpoint = request.body;
      const didDocument = await didService.addServiceEndpoint(did, endpoint, request.id);
      return reply.status(200).send({ didDocument });
    },
  );

  // ─── DELETE /v1/dids/:did/services/:endpointId — Remove service endpoint ────

  fastify.delete<{
    Params: { did: string; endpointId: string };
  }>(
    '/:did/services/:endpointId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['did', 'endpointId'],
          properties: {
            did: { type: 'string', pattern: DID_PATTERN },
            endpointId: { type: 'string' },
          },
        },
        response: {
          200: { type: 'object', properties: { didDocument: didDocumentSchema } },
          404: errorResponseSchema,
          410: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { did, endpointId } = request.params;
      // endpointId in URL is without #, add it
      const normalizedId = endpointId.startsWith('#') ? endpointId : `#${endpointId}`;
      const didDocument = await didService.removeServiceEndpoint(did, normalizedId, request.id);
      return reply.status(200).send({ didDocument });
    },
  );

  // ─── POST /v1/dids/:did/deactivate — Deactivate DID ─────────────────────────

  fastify.post<{
    Params: { did: string };
    Body: { reason: string };
  }>(
    '/:did/deactivate',
    {
      schema: {
        params: {
          type: 'object',
          required: ['did'],
          properties: {
            did: { type: 'string', pattern: DID_PATTERN },
          },
        },
        body: {
          type: 'object',
          required: ['reason'],
          properties: {
            reason: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              did: { type: 'string' },
              deactivated: { type: 'boolean' },
            },
          },
          404: errorResponseSchema,
          410: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { did } = request.params;
      const { reason } = request.body;
      await didService.deactivateDID(did, reason, request.id);
      return reply.status(200).send({ did, deactivated: true });
    },
  );

  // ─── Global error handler for this plugin ───────────────────────────────────

  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof HelixError) {
      fastify.log.warn({ code: error.code, requestId: request.id }, error.message);
      return reply.status(error.httpStatus).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }

    if (error && typeof error === 'object' && 'validation' in error && (error as any).validation) {
      return reply.status(400).send({
        error: {
          code: ErrorCodes.VALIDATION_ERROR,
          message: (error as any).message || 'Validation error',
          requestId: request.id,
        },
      });
    }

    fastify.log.error({ requestId: request.id, err: error }, 'Internal error');
    return reply.status(500).send({
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'An internal error occurred.',
        requestId: request.id,
      },
    });
  });
};

export default didRoutes;

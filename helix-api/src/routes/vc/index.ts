import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { HelixError } from '@helix-id/core';
import type { IVCService, IssueVCInput, RenewVCOverrides } from '../../services/vc/IVCService.js';

interface VCRouteOptions {
  vcService: IVCService;
}

const VC_ID_PATTERN = String.raw`^vc:helix:[a-zA-Z0-9]+$`;

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

function sendError(reply: FastifyReply, requestId: string, error: unknown) {
  if (error instanceof HelixError) {
    return reply.code(error.httpStatus).send({
      error: { code: error.code, message: error.message, requestId },
    });
  }
  return reply.code(500).send({
    error: { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : 'Internal error', requestId },
  });
}

const vcRoutes: FastifyPluginAsync<VCRouteOptions> = async (fastify, options) => {
  fastify.post<{ Body: IssueVCInput }>(
    '/vcs',
    {
      schema: {
        body: {
          type: 'object',
          required: ['subjectDid', 'subjectType', 'expiresInSeconds'],
          properties: {
            subjectDid: { type: 'string', minLength: 1 },
            subjectType: { type: 'string', enum: ['agent', 'user'] },
            privilegeScopes: { type: 'array', items: { type: 'string' } },
            agentName: { type: 'string', minLength: 1 },
            userId: { type: 'string', minLength: 1 },
            expiresInSeconds: { type: 'integer', minimum: 3600, maximum: 31_536_000 },
          },
        },
        response: { 201: { type: 'object', additionalProperties: true }, 400: errorResponseSchema, 404: errorResponseSchema, 503: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const result = await options.vcService.issueVC(request.body, request.id);
        return reply.code(201).send(result);
      } catch (error) {
        return sendError(reply, request.id, error);
      }
    },
  );

  fastify.get<{ Params: { vcId: string } }>(
    '/vcs/:vcId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['vcId'],
          properties: { vcId: { type: 'string', pattern: VC_ID_PATTERN } },
        },
        response: { 200: { type: 'object', additionalProperties: true }, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(await options.vcService.getVC(request.params.vcId, request.id));
      } catch (error) {
        return sendError(reply, request.id, error);
      }
    },
  );

  fastify.post<{ Params: { vcId: string } }>(
    '/vcs/:vcId/revoke',
    {
      schema: {
        params: {
          type: 'object',
          required: ['vcId'],
          properties: { vcId: { type: 'string', pattern: VC_ID_PATTERN } },
        },
        response: { 200: { type: 'object', additionalProperties: true }, 404: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        return reply.code(200).send(await options.vcService.revokeVC(request.params.vcId, request.id));
      } catch (error) {
        return sendError(reply, request.id, error);
      }
    },
  );

  fastify.post<{ Params: { vcId: string }; Body: RenewVCOverrides }>(
    '/vcs/:vcId/renew',
    {
      schema: {
        params: {
          type: 'object',
          required: ['vcId'],
          properties: { vcId: { type: 'string', pattern: VC_ID_PATTERN } },
        },
        body: {
          type: 'object',
          properties: {
            privilegeScopes: { type: 'array', items: { type: 'string' } },
            expiresInSeconds: { type: 'integer', minimum: 3600, maximum: 31_536_000 },
          },
        },
        response: { 201: { type: 'object', additionalProperties: true }, 404: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      try {
        const result = await options.vcService.renewVC(request.params.vcId, request.body ?? {}, request.id);
        return reply.code(201).send(result);
      } catch (error) {
        return sendError(reply, request.id, error);
      }
    },
  );

  fastify.get<{ Params: { listId: string } }>(
    '/status-list/:listId',
    { schema: { response: { 200: { type: 'object', additionalProperties: true }, 404: errorResponseSchema } } },
    async (request, reply) => {
      try {
        reply.header('Cache-Control', 'public, max-age=300');
        return reply.code(200).send(await options.vcService.getStatusListCredential(request.params.listId));
      } catch (error) {
        return sendError(reply, request.id, error);
      }
    },
  );
};

export default vcRoutes;

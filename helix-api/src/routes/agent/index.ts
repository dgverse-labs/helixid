// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import type { FastifyPluginAsync } from 'fastify';
import type { IAgentService } from '../../services/agent/IAgentService.js';
import { mapAgentError } from '../../services/agent/agent.service.js';

interface AgentRouteOptions {
  agentService: IAgentService;
}

const agentRoutes: FastifyPluginAsync<AgentRouteOptions> = async (fastify, options) => {
  fastify.post('/enrollment-tokens', async (request, reply) => {
    try {
      const result = await options.agentService.generateEnrollmentToken(
        request.body as { agentName: string; requestedScopes: string[]; requestedDomains?: string[] },
        request.id
      );
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply.code(mapped.statusCode).send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.post('/onboard', async (request, reply) => {
    try {
      const result = await options.agentService.processOnboardStep1(
        request.body as { enrollmentToken: string; publicKeyHex: string; domains?: string[] },
        request.id
      );
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply.code(mapped.statusCode).send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.post('/onboard/verify', async (request, reply) => {
    try {
      const result = await options.agentService.processOnboardVerify(
        request.body as { challengeId: string; signature: string; didCreateSignature?: string },
        request.id
      );
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply.code(mapped.statusCode).send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.post('/challenges', async (request, reply) => {
    try {
      const result = await options.agentService.issueUserChallenge(
        request.body as { did: string; purpose: 'user_verification' },
        request.id
      );
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply.code(mapped.statusCode).send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.post('/challenges/:challengeId/verify', async (request, reply) => {
    try {
      const params = request.params as { challengeId: string };
      const body = request.body as { signature: string };
      const result = await options.agentService.verifyUserChallenge(params.challengeId, body, request.id);
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply.code(mapped.statusCode).send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.get('/services', async (_request, reply) => {
    const result = await options.agentService.listServices();
    return reply.code(200).send(result);
  });

  fastify.get('/services/:serviceName', async (request, reply) => {
    try {
      const params = request.params as { serviceName: string };
      const result = await options.agentService.getService(params.serviceName);
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply.code(mapped.statusCode).send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.post('/services', async (request, reply) => {
    try {
      const result = await options.agentService.createService(
        request.body as {
          serviceName: string;
          displayName: string;
          verifiedDomain: string;
          publicKeyMultibase: string;
          apiEndpoint: string;
          metadata: Record<string, unknown>;
        },
        request.id
      );
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply.code(mapped.statusCode).send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });
};

export default agentRoutes;

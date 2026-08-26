// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import type { FastifyPluginAsync } from 'fastify';
import { AuditEvents } from '../../core/index.js';
import type { IAgentService } from '../../services/agent/IAgentService.js';
import { mapAgentError } from '../../services/agent/agent.service.js';
import {
  resolveAccountOrAdmin,
  type AccountOrAdminGuardDeps,
} from '../../services/auth/account-or-admin-guard.js';

interface AgentRouteOptions {
  agentService: IAgentService;
  /** Enables hosted-account bearer-token enrollment-token generation, quota- and verification-gated. Omit to preserve the original open (no-auth) behavior. */
  accountOrAdminGuardDeps?: AccountOrAdminGuardDeps | undefined;
  /** Required alongside accountOrAdminGuardDeps — see docs/proposal-hosted-rate-limiting.md. */
  enrollmentTokenDailyQuota?: number | undefined;
}

const agentRoutes: FastifyPluginAsync<AgentRouteOptions> = async (fastify, options) => {
  fastify.post('/enrollment-tokens', async (request, reply) => {
    try {
      let accountId: string | undefined;
      if (options.accountOrAdminGuardDeps) {
        // Admin key, a verified+under-quota hosted-account bearer token, or
        // no auth at all are all accepted here (requireAuth: false)
        // deliberately — this route had no gate before hosted accounts
        // existed, and that self-hosted behavior is preserved. A bearer
        // token, if present, still gets the quota + verification checks.
        const result = await resolveAccountOrAdmin(request, options.accountOrAdminGuardDeps, {
          requireAuth: false,
          quota: options.enrollmentTokenDailyQuota
            ? {
                eventType: AuditEvents.ENROLLMENT_TOKEN_GENERATED,
                dailyLimit: options.enrollmentTokenDailyQuota,
              }
            : undefined,
        });
        accountId = result.accountId;
      }

      const body = request.body as {
        agentName: string;
        requestedScopes: string[];
        requestedDomains?: string[];
        maxDelegationDepth?: number;
      };
      const result = await options.agentService.generateEnrollmentToken(
        accountId ? { ...body, accountId } : body,
        request.id,
      );
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply
        .code(mapped.statusCode)
        .send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.post('/enroll', async (request, reply) => {
    try {
      const result = await options.agentService.enroll(
        request.body as {
          bootstrapToken: string;
          agentDid: string;
          timestamp: number;
          proofSignature: string;
        },
        request.id,
      );
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply
        .code(mapped.statusCode)
        .send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.post('/onboard', async (request, reply) => {
    try {
      const result = await options.agentService.processOnboardStep1(
        request.body as { enrollmentToken: string; publicKeyHex: string; domains?: string[] },
        request.id,
      );
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply
        .code(mapped.statusCode)
        .send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.post('/onboard/verify', async (request, reply) => {
    try {
      const result = await options.agentService.processOnboardVerify(
        request.body as { challengeId: string; signature: string; didCreateSignature?: string },
        request.id,
      );
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply
        .code(mapped.statusCode)
        .send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.post('/challenges', async (request, reply) => {
    try {
      const result = await options.agentService.issueUserChallenge(
        request.body as { did: string; purpose: 'user_verification' },
        request.id,
      );
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply
        .code(mapped.statusCode)
        .send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

  fastify.post('/challenges/:challengeId/verify', async (request, reply) => {
    try {
      const params = request.params as { challengeId: string };
      const body = request.body as { signature: string };
      const result = await options.agentService.verifyUserChallenge(
        params.challengeId,
        body,
        request.id,
      );
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = mapAgentError(error);
      return reply
        .code(mapped.statusCode)
        .send({ error: { code: mapped.code, message: mapped.message, requestId: request.id } });
    }
  });

};

export default agentRoutes;

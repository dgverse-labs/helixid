// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import type { FastifyPluginAsync } from 'fastify';
import type { IVPService } from '../../services/vp/IVPService.js';
import { mapErrorToResponse } from '../../services/vp/vp.service.js';

interface VPRouteOptions {
  vpService: IVPService;
}

const vpRoutes: FastifyPluginAsync<VPRouteOptions> = async (fastify, options) => {
  fastify.post('/verify', {
    schema: {
      body: {
        type: 'object',
        required: ['signedVP'],
        properties: {
          signedVP: { type: 'object' },
          session: { type: 'boolean', default: false }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const body = request.body as { signedVP: Parameters<IVPService['verifyVP']>[0]; session?: boolean };
      const result = await options.vpService.verifyVP(body.signedVP, request.id, { issueSession: body.session === true });
      return reply.code(200).send(result);
    } catch (error) {
      const mapped = mapErrorToResponse(error);
      return reply.code(mapped.statusCode).send({
        error: { code: mapped.code, message: mapped.message, requestId: request.id }
      });
    }
  });
};

export default vpRoutes;

import type { FastifyPluginAsync } from 'fastify';
import type { IVPService } from '../../services/vp/IVPService.js';
import { mapErrorToResponse } from '../../services/vp/vp.service.js';

interface VPRouteOptions {
  vpService: IVPService;
}

const vpRoutes: FastifyPluginAsync<VPRouteOptions> = async (fastify, options) => {
  fastify.post('/template', {
    schema: {
      body: {
        type: 'object',
        required: ['agentDid', 'userDid', 'targetService', 'vcType'],
        properties: {
          agentDid: { type: 'string' },
          userDid: { type: 'string' },
          targetService: { type: 'string' },
          vcType: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const requestId = request.id;
      const result = await options.vpService.generateVPTemplate(
        request.body as { agentDid: string; userDid: string; targetService: string; vcType: string },
        requestId
      );
      return reply.code(201).send(result);
    } catch (error) {
      const mapped = mapErrorToResponse(error);
      return reply.code(mapped.statusCode).send({
        error: { code: mapped.code, message: mapped.message, requestId: request.id }
      });
    }
  });

  fastify.post('/verify', {
    schema: {
      body: {
        type: 'object',
        required: ['signedVP'],
        properties: {
          signedVP: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    try {
      const body = request.body as { signedVP: Parameters<IVPService['verifyVP']>[0] };
      const result = await options.vpService.verifyVP(body.signedVP, request.id);
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

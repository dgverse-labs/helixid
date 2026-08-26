import type { FastifyPluginAsync } from 'fastify';
import type { DIDDocument } from '../../core/index.js';

interface DidWebRouteOptions {
  issuerDid: string;
  didRepository: {
    findDidById(did: string): Promise<{ didDocument: unknown } | null>;
  };
}

const didWebRoutes: FastifyPluginAsync<DidWebRouteOptions> = async (fastify, options) => {
  fastify.get('/.well-known/did.json', async (_request, reply) => {
    const issuer = await options.didRepository.findDidById(options.issuerDid);
    if (!issuer) {
      return reply.code(404).send({
        error: {
          code: 'DID_NOT_FOUND',
          message: 'Issuer DID document is not available.',
        },
      });
    }

    return reply
      .type('application/json')
      .header('Cache-Control', 'public, max-age=3600')
      .send(issuer.didDocument as DIDDocument);
  });
};

export default didWebRoutes;

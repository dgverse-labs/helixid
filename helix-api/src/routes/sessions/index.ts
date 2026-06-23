// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0

import type { FastifyPluginAsync } from 'fastify';
import { publicKeyToMultibase } from '@helixid/core';

interface SessionRouteOptions {
  publicKeyHex: string;
}

const sessionRoutes: FastifyPluginAsync<SessionRouteOptions> = async (fastify, options) => {
  fastify.get('/public-key', {
    schema: {
      response: {
        200: {
          type: 'object',
          required: ['publicKeyHex', 'publicKeyMultibase', 'alg', 'crv'],
          properties: {
            publicKeyHex: { type: 'string' },
            publicKeyMultibase: { type: 'string' },
            alg: { type: 'string', const: 'EdDSA' },
            crv: { type: 'string', const: 'Ed25519' },
          },
        },
      },
    },
  }, async (_request, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    return reply.code(200).send({
      publicKeyHex: options.publicKeyHex,
      publicKeyMultibase: publicKeyToMultibase(options.publicKeyHex),
      alg: 'EdDSA',
      crv: 'Ed25519',
    });
  });
};

export default sessionRoutes;

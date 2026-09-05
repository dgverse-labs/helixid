import type { FastifyInstance } from 'fastify';

export function registerErrorSchemas(app: FastifyInstance): void {
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
          details: { type: 'object', additionalProperties: true },
        },
      },
    },
  });
  app.addSchema({ $id: 'BadRequest', type: 'object', $ref: 'Error#' });
  app.addSchema({ $id: 'NotFound', type: 'object', $ref: 'Error#' });
  app.addSchema({ $id: 'Conflict', type: 'object', $ref: 'Error#' });
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { generateKeyPair, publicKeyToMultibase } from '@helixid/core';
import sessionRoutes from '../../src/routes/sessions/index.js';

describe('Session API integration', () => {
  let app: FastifyInstance;
  const keys = generateKeyPair();

  beforeAll(async () => {
    app = Fastify({ logger: false });
    await app.register(sessionRoutes, { prefix: '/v1/sessions', publicKeyHex: keys.publicKey });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/sessions/public-key returns cacheable Ed25519 public key metadata', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/sessions/public-key',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=3600');
    expect(response.json()).toEqual({
      publicKeyHex: keys.publicKey,
      publicKeyMultibase: publicKeyToMultibase(keys.publicKey),
      alg: 'EdDSA',
      crv: 'Ed25519',
    });
  });
});

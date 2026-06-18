import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { buildDIDDocument } from '@helix-id/core';

import didWebRoutes from '../../src/routes/did-web/index.js';

describe('did:web hosting route', () => {
  it('serves the issuer DID document with JSON content type and cache headers', async () => {
    const issuerDid = 'did:web:api.example.com';
    const didDocument = buildDIDDocument(issuerDid, 'a'.repeat(64));
    const app = Fastify({ logger: false });

    await app.register(didWebRoutes, {
      issuerDid,
      didRepository: {
        async findDidById(did: string) {
          return did === issuerDid ? { didDocument } : null;
        },
      },
    });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/.well-known/did.json' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['cache-control']).toBe('public, max-age=3600');
    expect(response.json()).toMatchObject({ id: issuerDid });

    await app.close();
  });
});

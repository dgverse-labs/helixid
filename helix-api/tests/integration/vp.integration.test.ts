import { describe, expect, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { VPBuilder } from '../../../helix-sdk-js/src/vp/VPBuilder.js';
import Fastify, { FastifyInstance } from 'fastify';
import { getPublicKey } from '@noble/ed25519';

import { VPRepository, prisma } from '../../src/repositories/vp.repository.js';
import { ServiceRegistryRepository } from '../../src/services/vp/ServiceRegistryRepository.js';
import { VPService } from '../../src/services/vp/vp.service.js';
import { MockDIDService } from '../mocks/MockDIDService.js';
import { MockVCService } from '../mocks/MockVCService.js';
import vpRoutes from '../../src/routes/vp/index.js';

class TestAuditLogger {
  public readonly events: Array<{ event: string; payload: Record<string, unknown> }> = [];
  log(event: string, payload: Record<string, unknown>): void {
    this.events.push({ event, payload });
  }
}

describe('VP integration API', () => {
  let app: FastifyInstance;
  let didService: MockDIDService;
  let vcService: MockVCService;
  let auditLogger: TestAuditLogger;

  const privateKeyHex = randomBytes(32).toString('hex');
  let publicKeyHex = '';
  const defaultDid = 'did:hedera:testnet:agent1';

  beforeAll(async () => {
    publicKeyHex = Buffer.from(await getPublicKey(privateKeyHex)).toString('hex');
    app = Fastify({ logger: false });
    
    didService = new MockDIDService({
      id: defaultDid,
      verificationMethod: [{ id: `${defaultDid}#key-1`, type: 'Ed25519VerificationKey2020', publicKeyHex }]
    });
    vcService = new MockVCService();
    auditLogger = new TestAuditLogger();

    const service = new VPService(
      new VPRepository(),
      didService,
      vcService,
      new ServiceRegistryRepository(['amazon']),
      auditLogger
    );
    await app.register(vpRoutes, { prefix: '/v1/vp', vpService: service });
    await app.ready();
    await prisma.vpId.deleteMany(); // Reset DB table once per file
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    auditLogger.events.length = 0;
    didService.setShouldThrow(false);
    vcService.setActiveVC({
      id: 'vc:test:1',
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      expirationDate: new Date(Date.now() + 60_000).toISOString(),
      credentialSubject: { privilegeScopes: ['read'] }
    });
  });

  it('POST /v1/vp/template success (201 with unsignedVP, vpId, expiresAt)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/template',
      payload: { agentDid: defaultDid, userDid: 'did:hedera:testnet:user1', targetService: 'amazon', vcType: 'HelixAgentCredential' }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.vpId).toBeDefined();
    expect(body.expiresAt).toBeDefined();
    expect(body.unsignedVP).toBeDefined();
    expect(body.unsignedVP.holder).toBe(defaultDid);
  });

  it('fails with 404 for unknown agentDid', async () => {
    didService.setShouldThrow(true);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/template',
      payload: { agentDid: 'did:hedera:testnet:unknown', userDid: 'did:hedera:testnet:user1', targetService: 'amazon', vcType: 'HelixAgentCredential' }
    });
    
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('VP_AGENT_DID_NOT_FOUND');
  });

  it('fails with 404 for unknown targetService', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/template',
      payload: { agentDid: defaultDid, userDid: 'did:hedera:testnet:user1', targetService: 'unknown', vcType: 'HelixAgentCredential' }
    });
    
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('SERVICE_NOT_FOUND');
  });

  it('fails with 400 when no active VC is found', async () => {
    vcService.setActiveVC(null);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/template',
      payload: { agentDid: defaultDid, userDid: 'did:hedera:testnet:user1', targetService: 'amazon', vcType: 'HelixAgentCredential' }
    });
    
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VP_NO_ACTIVE_VC');
  });

  it('POST /v1/vp/verify success -> 200 and setting consumedAt DB assertion', async () => {
    const tmplRes = await app.inject({
      method: 'POST',
      url: '/v1/vp/template',
      payload: { agentDid: defaultDid, userDid: 'did:hedera:testnet:user1', targetService: 'amazon', vcType: 'HelixAgentCredential' }
    });
    const template = tmplRes.json();

    const builder = new VPBuilder(template.unsignedVP);
    const signedVP = await builder.sign(privateKeyHex, `${defaultDid}#key-1`);

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/vp/verify',
      payload: { signedVP }
    });

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().valid).toBe(true);

    // Verify DB assertion for consumedAt
    const dbRecord = await prisma.vpId.findUnique({ where: { vpId: template.vpId } });
    expect(dbRecord?.consumedAt).not.toBeNull();
  });
});

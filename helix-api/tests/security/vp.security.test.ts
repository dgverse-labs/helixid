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

describe('VP security API', () => {
  let app: FastifyInstance;
  let didService: MockDIDService;
  let vcService: MockVCService;
  let auditLogger: TestAuditLogger;

  const privateKeyHex = randomBytes(32).toString('hex');
  const wrongPrivateKeyHex = randomBytes(32).toString('hex');
  let publicKeyHex = '';
  const defaultDid = 'did:hedera:testnet:agent-sec';

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
    await prisma.vpId.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    auditLogger.events.length = 0;
    didService.setShouldThrow(false);
    vcService.setStatus('active');
    vcService.setActiveVC({
      id: 'vc:test:sec1',
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      expirationDate: new Date(Date.now() + 60_000).toISOString(),
      credentialSubject: { privilegeScopes: ['read'] }
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getSignedVP = async (mutateTmpl?: (t: any) => any, useWrongKey = false): Promise<any> => {
    const tmplRes = await app.inject({
      method: 'POST',
      url: '/v1/vp/template',
      payload: { agentDid: defaultDid, userDid: 'did:hedera:testnet:user1', targetService: 'amazon', vcType: 'HelixAgentCredential' }
    });
    let tmpl = tmplRes.json().unsignedVP;
    if (mutateTmpl) tmpl = mutateTmpl(tmpl);
    
    const builder = new VPBuilder(tmpl);
    return builder.sign(useWrongKey ? wrongPrivateKeyHex : privateKeyHex, `${defaultDid}#key-1`);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expectOpaqueFailure = (response: any): void => {
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VP_VERIFICATION_FAILED');
  };

  it('rejects replay same signed VP twice (first 200, second 400)', async () => {
    const signedVP = await getSignedVP();

    const res1 = await app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP } });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP } });
    expectOpaqueFailure(res2);
  });

  it('handles concurrent replay reliably (Promise.all -> one 200, one 400)', async () => {
    const signedVP = await getSignedVP();

    const [res1, res2] = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP } }),
      app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP } })
    ]);

    const statuses = [res1.statusCode, res2.statusCode].sort((a,b) => a - b);
    expect(statuses).toEqual([200, 400]);

    if (res1.statusCode === 400) expectOpaqueFailure(res1);
    if (res2.statusCode === 400) expectOpaqueFailure(res2);
  });

  it('rejects tampered VP payload', async () => {
    const signedVP = await getSignedVP();
    signedVP.targetService = 'tampered'; // Modify after sign
    
    const res = await app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP } });
    expectOpaqueFailure(res);
  });

  it('rejects wrong private key signature', async () => {
    const signedVP = await getSignedVP(undefined, true);
    const res = await app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP } });
    expectOpaqueFailure(res);
  });

  it('rejects expired VP (DB expiry forced)', async () => {
    const signedVP = await getSignedVP();
    // manipulate DB explicitly
    await prisma.vpId.updateMany({
      where: { vpId: signedVP.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const res = await app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP } });
    expectOpaqueFailure(res);
  });

  it('rejects revoked VC (mock status)', async () => {
    const signedVP = await getSignedVP();
    vcService.setStatus('revoked');

    const res = await app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP } });
    expectOpaqueFailure(res);
  });

  it('rejects expired VC (mock status)', async () => {
    const signedVP = await getSignedVP();
    vcService.setStatus('expired');

    const res = await app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP } });
    expectOpaqueFailure(res);
  });

  it('rejects unknown vpId', async () => {
    const signedVP = await getSignedVP((t) => ({ ...t, id: 'vp:helix:fake123' }));
    
    const res = await app.inject({ method: 'POST', url: '/v1/vp/verify', payload: { signedVP } });
    expectOpaqueFailure(res);
  });
});

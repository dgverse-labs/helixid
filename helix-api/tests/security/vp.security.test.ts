import { describe, expect, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { VPBuilder } from '@helix-id/sdk-js';
import Fastify, { FastifyInstance } from 'fastify';
import { getPublicKey } from '@noble/ed25519';
import { base58btcEncode, hashCanonicalPayload, signBytes, type AuditEvent, type AuditEventType } from '@helix-id/core';

import { VPRepository, type VpIdRecord } from '../../src/repositories/vp.repository.js';
import { ServiceRegistryRepository } from '../../src/repositories/service-registry.repository.js';
import { VPService } from '../../src/services/vp/vp.service.js';
import { MockDIDService } from '../mocks/MockDIDService.js';
import { MockVCService } from '../mocks/MockVCService.js';
import vpRoutes from '../../src/routes/vp/index.js';

class TestAuditLogger {
  public readonly events: Array<{ event: AuditEvent; payload: Record<string, unknown> }> = [];

  log(event: AuditEvent): void;
  log(event: AuditEventType, payload: Record<string, unknown> & { requestId: string; timestamp?: string }): void;
  log(
    event: AuditEvent | AuditEventType,
    payload?: Record<string, unknown> & { requestId: string; timestamp?: string },
  ): void {
    if (typeof event === 'string') {
      this.events.push({
        event: {
          event,
          timestamp: payload?.timestamp ?? new Date().toISOString(),
          requestId: payload?.requestId ?? 'test-request',
          ...payload,
        },
        payload: payload ?? {},
      });
      return;
    }
    this.events.push({ event, payload: event });
  }
}

class InMemoryVPRepository extends VPRepository {
  private readonly records = new Map<string, VpIdRecord>();

  override async create(data: Omit<VpIdRecord, 'consumedAt'>): Promise<VpIdRecord> {
    const record = { ...data, consumedAt: null };
    this.records.set(record.vpId, record);
    return record;
  }

  override async findByVpId(vpId: string): Promise<VpIdRecord | null> {
    return this.records.get(vpId) ?? null;
  }

  override async consumeAtomically(vpId: string): Promise<boolean> {
    const record = this.records.get(vpId);
    if (!record || record.consumedAt) return false;
    record.consumedAt = new Date();
    return true;
  }

  expire(vpId: string): void {
    const record = this.records.get(vpId);
    if (record) record.expiresAt = new Date(Date.now() - 1000);
  }

  clear(): void {
    this.records.clear();
  }
}

describe('VP security API', () => {
  let app: FastifyInstance;
  let didService: MockDIDService;
  let vcService: MockVCService;
  let auditLogger: TestAuditLogger;
  let repository: InMemoryVPRepository;

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
    repository = new InMemoryVPRepository();

    const service = new VPService(
      repository,
      didService,
      vcService,
      new ServiceRegistryRepository(['amazon']),
      auditLogger
    );
    await app.register(vpRoutes, { prefix: '/v1/vp', vpService: service });
    await app.ready();
    repository.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    auditLogger.events.length = 0;
    didService.setShouldThrow(false);
    vcService.setStatus('active');
    vcService.setActiveVC(await signTestVC({
      id: 'vc:test:sec1',
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: defaultDid,
      expirationDate: new Date(Date.now() + 60_000).toISOString(),
      credentialSubject: { privilegeScopes: ['read'] }
    }));
  });

  async function signTestVC(vc: Record<string, unknown>): Promise<Record<string, unknown>> {
    const signatureHex = await signBytes(hashCanonicalPayload(vc), privateKeyHex);
    return {
      ...vc,
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: `${defaultDid}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: base58btcEncode(Buffer.from(signatureHex, 'hex')),
      },
    };
  }

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
    repository.expire(signedVP.id);

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

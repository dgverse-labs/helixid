import { describe, expect, it, beforeEach, afterAll, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import Fastify, { FastifyInstance } from 'fastify';
import { getPublicKey } from '@noble/ed25519';
import { base58btcEncode, hashCanonicalPayload, signBytes, type AuditEvent, type AuditEventType, type SignedVP } from '@helix-id/core';

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

  clear(): void {
    this.records.clear();
  }
}

describe('VP integration API', () => {
  let app: FastifyInstance;
  let didService: MockDIDService;
  let vcService: MockVCService;
  let auditLogger: TestAuditLogger;
  let repository: InMemoryVPRepository;
  let service: VPService;

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
    repository = new InMemoryVPRepository();

    service = new VPService(
      repository,
      didService,
      vcService,
      new ServiceRegistryRepository(['amazon']),
      auditLogger,
      300,
      { signingKey: privateKeyHex, issuerDid: defaultDid, ttlSeconds: 600 }
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
    vcService.setActiveVC(await signTestVC({
      id: 'vc:test:1',
      type: ['VerifiableCredential', 'HelixAgentCredential'],
      issuer: defaultDid,
      validUntil: new Date(Date.now() + 60_000).toISOString(),
      credentialStatus: {
        statusListCredential: 'http://localhost:3000/v1/status-list/helix-status-list-1',
        statusListIndex: '0',
      },
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

  it('POST /v1/vp/template is removed from the API', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/template',
      payload: { agentDid: defaultDid, userDid: 'did:hedera:testnet:user1', targetService: 'amazon', vcType: 'HelixAgentCredential' }
    });

    expect(response.statusCode).toBe(404);
  });

  it('POST /v1/vp/verify without session returns 410 with SDK redirect', async () => {
    const { signedVP } = await createSignedVP();

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/vp/verify',
      payload: { signedVP }
    });

    expect(verifyRes.statusCode).toBe(410);
    expect(verifyRes.json().error.message).toContain('VP verification is now handled by the SDK');
  });

  it('POST /v1/vp/verify with session true returns a JWT session', async () => {
    const { signedVP, vpId } = await createSignedVP();

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/vp/verify',
      payload: { signedVP, session: true }
    });

    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().session).toMatchObject({
      publicKeyEndpoint: '/v1/sessions/public-key',
    });
    expect(verifyRes.json().session.token).toMatch(/^[^.]+\.[^.]+\.[^.]+$/);
    expect(auditLogger.events.some((entry) => entry.event.event === 'JWT_ISSUED')).toBe(true);
    const dbRecord = await repository.findByVpId(vpId);
    expect(dbRecord?.consumedAt).not.toBeNull();
  });

  async function createSignedVP(): Promise<{ signedVP: SignedVP; vpId: string }> {
    const template = await service.generateVPTemplate(
      {
        agentDid: defaultDid,
        userDid: 'did:hedera:testnet:user1',
        targetService: 'amazon',
        vcType: 'HelixAgentCredential',
      },
      'req_test',
    );
    const signatureHex = await signBytes(hashCanonicalPayload(template.unsignedVP), privateKeyHex);
    const signedVP = {
      ...template.unsignedVP,
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: `${defaultDid}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: base58btcEncode(Buffer.from(signatureHex, 'hex')),
      },
    } as SignedVP;
    return { signedVP, vpId: template.vpId };
  }
});

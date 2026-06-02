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

    const service = new VPService(
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

  it('POST /v1/vp/template uses explicit vcId when provided', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/vp/template',
      payload: {
        agentDid: defaultDid,
        userDid: 'did:hedera:testnet:user1',
        targetService: 'amazon',
        vcType: 'HelixAgentCredential',
        vcId: 'vc:test:1',
      }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().unsignedVP.verifiableCredential[0].id).toBe('vc:test:1');
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

    const dbRecord = await repository.findByVpId(template.vpId);
    expect(dbRecord?.consumedAt).not.toBeNull();
  });

  it('POST /v1/vp/verify with session true returns a JWT session', async () => {
    const tmplRes = await app.inject({
      method: 'POST',
      url: '/v1/vp/template',
      payload: { agentDid: defaultDid, userDid: 'did:hedera:testnet:user1', targetService: 'amazon', vcType: 'HelixAgentCredential' }
    });
    const template = tmplRes.json();
    const signedVP = await new VPBuilder(template.unsignedVP).sign(privateKeyHex, `${defaultDid}#key-1`);

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
  });
});

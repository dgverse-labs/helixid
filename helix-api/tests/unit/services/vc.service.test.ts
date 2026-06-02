// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VCService } from '../../../src/services/vc/vc.service.js';
import { 
  ErrorCode,
  buildDIDDocument,
  createStatusList,
  derivePublicKey,
  type AgentVC,
  type SignedVP,
} from '@helix-id/core';

describe('VCService Branch Coverage', () => {
  let repository: any;
  let didService: any;
  let auditLogger: any;
  let service: VCService;
  const validStatusList = createStatusList();
  const signingKey = 'a'.repeat(64);
  const issuerDid = 'did:hedera:testnet:testissuer';
  const issuerDocument = buildDIDDocument(issuerDid, derivePublicKey(signingKey));
  const parentVc: AgentVC = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helix-id.io/contexts/v1'],
    id: 'vc:parent',
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: issuerDid,
    validFrom: new Date(Date.now() - 1_000).toISOString(),
    validUntil: new Date(Date.now() + 60_000).toISOString(),
    credentialStatus: {
      id: 'http://localhost/v1/status-list/helix-status-list-1#0',
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: '0',
      statusListCredential: 'http://localhost/v1/status-list/helix-status-list-1',
    },
    credentialSubject: {
      id: 'did:agent:parent',
      type: 'HelixAgent',
      privilegeScopes: ['read:orders', 'write:orders'],
      agentName: 'Parent Agent',
      delegationDepth: 0,
      maxDelegationDepth: 1,
    },
  };
  const delegatorVP = {
    verifiableCredential: [{ id: 'vc:parent' }],
  } as SignedVP;

  beforeEach(() => {
    repository = {
      createVc: vi.fn(),
      findByVcId: vi.fn(),
      findActiveBySubjectDid: vi.fn(),
      updateRevocation: vi.fn(),
      createStatusList: vi.fn(),
      findStatusListById: vi.fn(),
      claimNextIndex: vi.fn(),
      revokeVc: vi.fn(),
      markAsRenewed: vi.fn(),
      findActiveStatusList: vi.fn(),
    };
    didService = {
      resolveDID: vi.fn().mockImplementation((did: string) => {
        if (did === issuerDid) return Promise.resolve({ didDocument: issuerDocument });
        return Promise.resolve({});
      }),
    };
    auditLogger = { log: vi.fn() };
    service = new VCService(
      repository,
      didService,
      auditLogger,
      signingKey,
      issuerDid,
      'http://localhost',
    );
  });

  describe('findActiveBySubjectDid', () => {
    it('returns null when no active VC exists', async () => {
        repository.findActiveBySubjectDid.mockResolvedValue([]);

        await expect(service.findActiveBySubjectDid('did:1')).resolves.toBeNull();
    });

    it('returns the only active VC and parses JSON strings', async () => {
        repository.findActiveBySubjectDid.mockResolvedValue([
          { vcJson: JSON.stringify({ id: 'vc-new' }) },
        ]);

        await expect(service.findActiveBySubjectDid('did:1', 'HelixAgentCredential'))
          .resolves.toEqual({ id: 'vc-new' });
    });

    it('throws VP_MULTIPLE_ACTIVE_VC when active matches are ambiguous', async () => {
        repository.findActiveBySubjectDid.mockResolvedValue([
          { vcJson: { id: 'vc-1' } },
          { vcJson: { id: 'vc-2' } },
        ]);

        await expect(service.findActiveBySubjectDid('did:1', 'HelixAgentCredential'))
          .rejects.toMatchObject({ code: ErrorCode.VP_MULTIPLE_ACTIVE_VC });
    });

    it('findActiveByVcIdForSubject returns a matching active VC only', async () => {
        repository.findByVcId.mockResolvedValue({
          vcId: 'vc-1',
          subjectDid: 'did:1',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          vcJson: { id: 'vc-1', type: ['VerifiableCredential', 'HelixAgentCredential'] },
        });

        await expect(service.findActiveByVcIdForSubject('vc-1', 'did:1', 'HelixAgentCredential'))
          .resolves.toEqual({ id: 'vc-1', type: ['VerifiableCredential', 'HelixAgentCredential'] });
        await expect(service.findActiveByVcIdForSubject('vc-1', 'did:other', 'HelixAgentCredential'))
          .resolves.toBeNull();
        await expect(service.findActiveByVcIdForSubject('vc-1', 'did:1', 'HelixUserCredential'))
          .resolves.toBeNull();
    });
  });

  describe('record lookup and delegation branches', () => {
    it('returns null and computed statuses from findRecordByVcId', async () => {
        repository.findByVcId.mockResolvedValueOnce(null);
        await expect(service.findRecordByVcId('missing')).resolves.toBeNull();

        repository.findByVcId.mockResolvedValueOnce({
          vcId: 'vc:active',
          vcJson: { id: 'vc:active' },
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        });
        await expect(service.findRecordByVcId('vc:active')).resolves.toMatchObject({
          vcId: 'vc:active',
          status: 'active',
        });

        repository.findByVcId.mockResolvedValueOnce({
          vcId: 'vc:revoked',
          vcJson: { id: 'vc:revoked' },
          revokedAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        });
        await expect(service.findRecordByVcId('vc:revoked')).resolves.toMatchObject({
          status: 'revoked',
        });

        repository.findByVcId.mockResolvedValueOnce({
          vcId: 'vc:expired',
          vcJson: { id: 'vc:expired' },
          revokedAt: null,
          expiresAt: new Date(Date.now() - 60_000),
        });
        await expect(service.findRecordByVcId('vc:expired')).resolves.toMatchObject({
          status: 'expired',
        });
    });

    it('throws when delegation is requested before VP service wiring', async () => {
        await expect(service.delegateVC({
          delegatorVP,
          delegateeAgentDid: 'did:agent:child',
          requestedScopes: ['read:orders'],
        }, 'req-1')).rejects.toThrow('vp_service_not_configured');
    });

    it('delegates an agent VC through a verified parent VP', async () => {
        service.setVPService({
          verifyVP: vi.fn().mockResolvedValue({ agentDid: 'did:agent:parent' }),
        } as any);
        repository.findByVcId.mockResolvedValue({
          vcId: 'vc:parent',
          subjectDid: 'did:agent:parent',
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
          vcJson: parentVc,
        });
        repository.findStatusListById.mockResolvedValue({ id: 'helix-status-list-1', nextIndex: 0, encodedList: validStatusList });
        repository.claimNextIndex.mockResolvedValue({ list: { id: 'helix-status-list-1' }, claimedIndex: 0 });
        repository.createVc.mockResolvedValue({});

        const result = await service.delegateVC({
          delegatorVP,
          delegateeAgentDid: 'did:agent:child',
          requestedScopes: ['read:orders'],
          expiresInSeconds: 120,
        }, 'req-1');

        expect(result).toMatchObject({
          delegateeAgentDid: 'did:agent:child',
          delegatedFrom: 'did:agent:parent',
          delegationDepth: 1,
          scopes: ['read:orders'],
        });
        expect(repository.createVc).toHaveBeenCalledWith(expect.objectContaining({
          subjectDid: 'did:agent:child',
          delegatedFrom: 'did:agent:parent',
          delegationDepth: 1,
          maxDelegationDepth: 1,
          parentVcId: 'vc:parent',
        }));
        expect(auditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
          event: 'VC_DELEGATED',
          parentVcId: 'vc:parent',
        }));
    });
  });

  describe('issueVC branches', () => {
    it('throws STATUS_LIST_INDEX_EXHAUSTED if list full', async () => {
        repository.findStatusListById.mockResolvedValue({ id: 'l1', nextIndex: 131072 });
        await expect(service.issueVC({ subjectDid: 'did:1', subjectType: 'user', userId: 'u1' }, 'req-1'))
          .rejects.toMatchObject({ code: ErrorCode.STATUS_LIST_INDEX_EXHAUSTED });
    });

    it('throws VALIDATION_ERROR for user with scopes', async () => {
        await expect(service.issueVC({ subjectDid: 'did:1', subjectType: 'user', userId: 'u1', privilegeScopes: ['read'] }, 'req-1'))
          .rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it('throws VALIDATION_ERROR for agent without scopes or name', async () => {
        await expect(service.issueVC({ subjectDid: 'did:1', subjectType: 'agent', agentName: '' }, 'req-1'))
          .rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR });
    });

    it('throws ISSUER_SIGNING_KEY_MISMATCH before claiming an index if issuer DID key differs', async () => {
        const mismatchedIssuerDocument = buildDIDDocument(issuerDid, derivePublicKey('b'.repeat(64)));
        didService.resolveDID.mockImplementation((did: string) => {
          if (did === issuerDid) return Promise.resolve({ didDocument: mismatchedIssuerDocument });
          return Promise.resolve({});
        });
        repository.findStatusListById.mockResolvedValue({ id: 'l1', nextIndex: 0, encodedList: validStatusList });

        await expect(service.issueVC({ subjectDid: 'did:1', subjectType: 'user', userId: 'u1' }, 'req-1'))
          .rejects.toMatchObject({ code: ErrorCode.ISSUER_SIGNING_KEY_MISMATCH });
        expect(repository.claimNextIndex).not.toHaveBeenCalled();
        expect(repository.createVc).not.toHaveBeenCalled();
    });
  });

  describe('revokeVC branches', () => {
    it('throws VC_NOT_FOUND if record missing', async () => {
        repository.findByVcId.mockResolvedValue(null);
        await expect(service.revokeVC('v1', 'req-1')).rejects.toMatchObject({ code: ErrorCode.VC_NOT_FOUND });
    });

    it('throws VC_ALREADY_REVOKED if already revoked', async () => {
        repository.findByVcId.mockResolvedValue({ revokedAt: new Date() });
        await expect(service.revokeVC('v1', 'req-1')).rejects.toMatchObject({ code: ErrorCode.VC_ALREADY_REVOKED });
    });
  });

  describe('renewVC branches', () => {
    it('throws VC_NOT_FOUND if old VC missing', async () => {
        repository.findByVcId.mockResolvedValue(null);
        await expect(service.renewVC('v1', {}, 'req-1')).rejects.toMatchObject({ code: ErrorCode.VC_NOT_FOUND });
    });

    it('throws VC_ALREADY_REVOKED if old VC revoked', async () => {
        repository.findByVcId.mockResolvedValue({ revokedAt: new Date() });
        await expect(service.renewVC('v1', {}, 'req-1')).rejects.toMatchObject({ code: ErrorCode.VC_ALREADY_REVOKED });
    });

    it('renews VC successfully', async () => {
        const oldVc = { 
            vcId: 'v1', 
            subjectDid: 'd1', 
            subjectType: 'user', 
            userId: 'u1', 
            statusListId: 'l1', 
            statusListIndex: 0,
            vcJson: { credentialSubject: { userId: 'u1' } },
            expiresAt: new Date(Date.now() + 100000)
        };
        repository.findByVcId.mockResolvedValue(oldVc);
        repository.findStatusListById.mockResolvedValue({ id: 'l1', nextIndex: 1, encodedList: validStatusList });
        repository.claimNextIndex.mockResolvedValue({ list: { id: 'l1' }, claimedIndex: 1 });
        repository.createVc.mockResolvedValue({ vcId: 'v2', vcJson: {} });
        
        const res = await service.renewVC('v1', {}, 'req-1');
        expect(res.vcId).toMatch(/^vc:helix:[0-9a-f]{24}$/);
        expect(repository.markAsRenewed).toHaveBeenCalledWith('v1', res.vcId);
    });
  });

  describe('getVC/getVCStatus branches', () => {
    it('handles not found in getVC', async () => {
        repository.findByVcId.mockResolvedValue(null);
        await expect(service.getVC('v1', 'req-1')).rejects.toMatchObject({ code: ErrorCode.VC_NOT_FOUND });
    });

    it('returns active status', async () => {
        repository.findByVcId.mockResolvedValue({ 
          vcId: 'v1', 
          expiresAt: new Date(Date.now() + 10000), 
          vcJson: { credentialSubject: {} } 
        });
        const res = await service.getVCStatus('v1');
        expect(res).toBe('active');
        const details = await service.getVC('v1', 'req-1');
        expect(details.status).toBe('active');
    });

    it('returns revoked status', async () => {
        repository.findByVcId.mockResolvedValue({ 
          vcId: 'v1', 
          revokedAt: new Date(), 
          expiresAt: new Date(Date.now() + 10000), 
          vcJson: { credentialSubject: {} } 
        });
        const res = await service.getVCStatus('v1');
        expect(res).toBe('revoked');
        const details = await service.getVC('v1', 'req-1');
        expect(details.status).toBe('revoked');
    });

    it('returns expired status', async () => {
        repository.findByVcId.mockResolvedValue({ 
          vcId: 'v1', 
          expiresAt: new Date(Date.now() - 10000), 
          vcJson: { credentialSubject: {} } 
        });
        const res = await service.getVCStatus('v1');
        expect(res).toBe('expired');
        const details = await service.getVC('v1', 'req-1');
        expect(details.status).toBe('expired');
    });
  });

  describe('getStatusList branches', () => {
    it('throws STATUS_LIST_NOT_FOUND if missing', async () => {
        repository.findStatusListById.mockResolvedValue(null);
        await expect(service.getStatusList('l1')).rejects.toMatchObject({ code: ErrorCode.STATUS_LIST_NOT_FOUND });
    });
  });
});

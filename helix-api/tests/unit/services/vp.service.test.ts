// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VPService, mapErrorToResponse } from '../../../src/services/vp/vp.service.js';
import { 
    VPVerificationFailedError, 
    VPAgentDIDNotFoundError,
    createStatusList,
    generateKeyPair,
    type AgentVC,
} from '@helixid/core';
import { ServiceNotFoundError } from '../../../src/repositories/service-registry.repository.js';

vi.mock('@helixid/core', async () => {
  const actual = await vi.importActual('@helixid/core') as any;
  return {
    ...actual,
    verifySignature: vi.fn(),
    hashCanonicalPayload: vi.fn(() => Buffer.from('hash')),
    base58btcDecode: vi.fn((val: string) => {
        if (val === 'invalid') return new Uint8Array();
        return new Uint8Array(64).fill(0);
    }),
    base58btcEncode: vi.fn(() => 'zabc'),
  };
});

import { verifySignature } from '@helixid/core';

describe('VPService Branch Coverage', () => {
  let repository: any;
  let didService: any;
  let vcService: any;
  let serviceRegistry: any;
  let auditLogger: any;
  let service: VPService;

  const validVP = { 
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiablePresentation'],
    id: 'vp:helix:123', 
    holder: 'did:h:1', 
    delegatedBy: 'did:h:2', 
    targetService: 's1',
    nonce: 'a'.repeat(64),
    expirationDate: new Date(Date.now() + 10000).toISOString(), 
    verifiableCredential: [{ 
        id: 'vc1', 
        issuer: 'did:helix:issuer', 
        validUntil: new Date(Date.now() + 10000).toISOString(),
        credentialStatus: {
          statusListCredential: 'http://localhost:3000/v1/status-list/helix-status-list-1',
          statusListIndex: '0',
        },
        proof: { proofValue: 'zproof', verificationMethod: 'did:helix:issuer#key-1' } 
    }], 
    proof: { 
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: 'did:h:1#key-1',
        proofPurpose: 'assertionMethod',
        proofValue: 'zproof' 
    } 
  };

  const statusEntry = {
    id: 'http://localhost:3000/v1/status-list/helix-status-list-1#0',
    type: 'BitstringStatusListEntry' as const,
    statusPurpose: 'revocation' as const,
    statusListIndex: '0',
    statusListCredential: 'http://localhost:3000/v1/status-list/helix-status-list-1',
  };

  const parentVC: AgentVC = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://helixid.io/contexts/v1'],
    id: 'vc-parent',
    type: ['VerifiableCredential', 'HelixAgentCredential'],
    issuer: 'did:helix:issuer',
    validFrom: new Date(Date.now() - 1_000).toISOString(),
    validUntil: new Date(Date.now() + 60_000).toISOString(),
    credentialStatus: statusEntry,
    credentialSubject: {
      id: 'did:agent:parent',
      type: 'HelixAgent',
      privilegeScopes: ['read:orders', 'write:orders'],
      agentName: 'Parent Agent',
      delegationDepth: 0,
      maxDelegationDepth: 1,
    },
    proof: {
      type: 'Ed25519Signature2020',
      created: new Date().toISOString(),
      verificationMethod: 'did:helix:issuer#key-1',
      proofPurpose: 'assertionMethod',
      proofValue: 'zproof',
    },
  };

  const childVC: AgentVC = {
    ...parentVC,
    id: 'vc-child',
    credentialSubject: {
      id: 'did:h:1',
      type: 'HelixAgent',
      privilegeScopes: ['read:orders'],
      agentName: 'Child Agent',
      delegatedFrom: 'did:agent:parent',
      delegationDepth: 1,
      maxDelegationDepth: 1,
      parentVcId: 'vc-parent',
    },
  };

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      findByVpId: vi.fn(),
      consumeAtomically: vi.fn(),
    };
    didService = { resolveDID: vi.fn() };
    vcService = {
      getVC: vi.fn(),
      getVCStatus: vi.fn(),
      getStatusList: vi.fn(),
      findActiveBySubjectDid: vi.fn(),
      findActiveByVcIdForSubject: vi.fn(),
      findRecordByVcId: vi.fn(),
    };
    serviceRegistry = { assertExists: vi.fn() };
    auditLogger = { log: vi.fn() };
    service = new VPService(repository, didService, vcService, serviceRegistry, auditLogger);
    vcService.getStatusList.mockResolvedValue({ credentialSubject: { encodedList: createStatusList() } });
    vi.mocked(verifySignature).mockReset();
  });

  describe('generateVPTemplate branches', () => {
    it('throws VPAgentDIDNotFoundError if agent DID resolution fails', async () => {
        didService.resolveDID.mockRejectedValue(new Error('fail'));
        await expect(service.generateVPTemplate({ agentDid: 'd1', userDid: 'u1', targetService: 's1', vcType: 'HelixAgentCredential' }, 'req-1'))
            .rejects.toThrow(VPAgentDIDNotFoundError);
    });

    it('uses explicit vcId when provided', async () => {
        didService.resolveDID.mockResolvedValue({});
        vcService.findActiveByVcIdForSubject.mockResolvedValue({ id: 'vc-explicit' });

        const result = await service.generateVPTemplate({
          agentDid: 'd1',
          userDid: 'u1',
          targetService: 's1',
          vcType: 'HelixAgentCredential',
          vcId: 'vc-explicit',
        }, 'req-1');

        expect(result.unsignedVP.verifiableCredential[0]).toEqual({ id: 'vc-explicit' });
        expect(vcService.findActiveByVcIdForSubject).toHaveBeenCalledWith('vc-explicit', 'd1', 'HelixAgentCredential');
        expect(vcService.findActiveBySubjectDid).not.toHaveBeenCalled();
    });
  });

  describe('extractPublicKeyHex branches', () => {
    it('throws VPAgentDIDNotFoundError if no Ed25519 method', async () => {
        didService.resolveDID.mockResolvedValue({ verificationMethod: [{ type: 'Other' }] });
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        await expect(service.verifyVP(validVP as any, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('handles publicKeyMultibase', async () => {
        const vp = JSON.parse(JSON.stringify(validVP));
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({ 
            verificationMethod: [{ type: 'Ed25519VerificationKey2020', publicKeyMultibase: 'zabc' }] 
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        vcService.getVCStatus.mockResolvedValue('active');
        repository.consumeAtomically.mockResolvedValue(true);

        const res = await service.verifyVP(vp, 'req-1');
        expect(res.valid).toBe(true);
    });
  });

  describe('verifyVP branches', () => {
    it('throws VPInvalidStructureError for invalid schema', async () => {
        await expect(service.verifyVP({ id: 'bad' } as any, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('throws VPExpiredError if VP payload expirationDate passed', async () => {
        const vp = JSON.parse(JSON.stringify(validVP));
        vp.expirationDate = new Date(Date.now() - 10000).toISOString();
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        await expect(service.verifyVP(vp, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('throws VPAgentDIDNotFoundError if holder resolution fails', async () => {
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockRejectedValueOnce(new Error('fail'));
        await expect(service.verifyVP(validVP as any, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('throws Error(signature_invalid) if VP signature fails', async () => {
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({ 
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }] 
        });
        vi.mocked(verifySignature).mockResolvedValue(false);
        await expect(service.verifyVP(validVP as any, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('throws Error(vc_expired) if VC expired', async () => {
        const vp = JSON.parse(JSON.stringify(validVP));
        vp.verifiableCredential[0].validUntil = new Date(Date.now() - 10000).toISOString();
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({ 
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }] 
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        await expect(service.verifyVP(vp, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('throws VPInvalidStructureError if VC id missing', async () => {
        const vp = JSON.parse(JSON.stringify(validVP));
        delete vp.verifiableCredential[0].id;
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({ 
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }] 
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        await expect(service.verifyVP(vp, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('throws VCSignatureInvalidError if VC signature fails', async () => {
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({ 
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }] 
        });
        vi.mocked(verifySignature)
            .mockResolvedValueOnce(true) // VP signature
            .mockResolvedValueOnce(false); // VC signature
        await expect(service.verifyVP(validVP as any, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('throws VCIssuerNotFoundError if issuer resolution fails', async () => {
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockImplementation((did: string) => {
            if (did === 'did:helix:issuer') throw new Error('fail');
            return { verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }] };
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        await expect(service.verifyVP(validVP as any, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('throws VPAlreadyConsumedError if consumeAtomically fails', async () => {
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({ 
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }] 
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        vcService.getVCStatus.mockResolvedValue('active');
        repository.consumeAtomically.mockResolvedValue(false);
        await expect(service.verifyVP(validVP as any, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('bubbles up ServiceNotFoundError', async () => {
        repository.findByVpId.mockImplementation(() => {
            throw new ServiceNotFoundError('s1');
        });
        await expect(service.verifyVP(validVP as any, 'req-1')).rejects.toThrow(ServiceNotFoundError);
    });

    it('handles non-Error thrown values', async () => {
        repository.findByVpId.mockImplementation(() => {
            throw "string error";
        });
        await expect(service.verifyVP(validVP as any, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('verifies VC signature when issuer is hedera', async () => {
        const vp = JSON.parse(JSON.stringify(validVP));
        vp.verifiableCredential[0].issuer = 'did:hedera:testnet:123';
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({ 
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }] 
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        vcService.getVCStatus.mockResolvedValue('active');
        repository.consumeAtomically.mockResolvedValue(true);

        const res = await service.verifyVP(vp, 'req-1');
        expect(res.valid).toBe(true);
        expect(verifySignature).toHaveBeenCalledTimes(2);
    });

    it('rejects missing VC issuer', async () => {
        const vp = JSON.parse(JSON.stringify(validVP));
        delete vp.verifiableCredential[0].issuer;
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({ 
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }] 
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        vcService.getVCStatus.mockResolvedValue('active');
        repository.consumeAtomically.mockResolvedValue(true);

        await expect(service.verifyVP(vp, 'req-1')).rejects.toThrow(VPVerificationFailedError);
    });

    it('verifies a delegated agent VC chain', async () => {
        const vp = JSON.parse(JSON.stringify({
          ...validVP,
          verifiableCredential: [childVC],
        }));
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }]
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        vcService.findRecordByVcId.mockResolvedValue({
          vcId: 'vc-parent',
          vc: parentVC,
          status: 'active',
        });
        repository.consumeAtomically.mockResolvedValue(true);

        const res = await service.verifyVP(vp, 'req-1');

        expect(res.valid).toBe(true);
        expect(vcService.findRecordByVcId).toHaveBeenCalledWith('vc-parent');
        expect(auditLogger.log).toHaveBeenCalledWith('CHAIN_VERIFIED', expect.objectContaining({
          leafVcId: 'vc-child',
          chainDepth: 1,
        }));
    });

    it('rejects delegated chains when parent VC is unavailable', async () => {
        const vp = JSON.parse(JSON.stringify({
          ...validVP,
          verifiableCredential: [childVC],
        }));
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }]
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        vcService.findRecordByVcId.mockResolvedValue(null);

        await expect(service.verifyVP(vp, 'req-1')).rejects.toThrow(VPVerificationFailedError);
        expect(auditLogger.log).toHaveBeenCalledWith('CHAIN_REJECTED', expect.objectContaining({
          internalReason: 'parent_vc_not_found',
        }));
    });

    it('issues a JWT session when requested and configured', async () => {
        const keys = generateKeyPair();
        service = new VPService(repository, didService, vcService, serviceRegistry, auditLogger, 300, {
          signingKey: keys.privateKey,
          issuerDid: 'did:helix:issuer',
          ttlSeconds: 600,
        });
        const vp = JSON.parse(JSON.stringify(validVP));
        vp.verifiableCredential[0].credentialSubject = {
          privilegeScopes: ['read:orders', 123, 'write:orders'],
        };
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }]
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        vcService.getStatusList.mockResolvedValue({ credentialSubject: { encodedList: createStatusList() } });
        repository.consumeAtomically.mockResolvedValue(true);

        const res = await service.verifyVP(vp, 'req-1', { issueSession: true });

        expect(res.session?.token).toBeDefined();
        expect(res.session?.publicKeyEndpoint).toBe('/v1/sessions/public-key');
        expect(auditLogger.log).toHaveBeenCalledWith('JWT_ISSUED', expect.objectContaining({
          agentDid: 'did:h:1',
          targetService: 's1',
        }));
    });

    it('rejects session issuance when JWT options are missing', async () => {
        repository.findByVpId.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        didService.resolveDID.mockResolvedValue({
            verificationMethod: [{ type: 'Ed25519', publicKeyHex: '00' }]
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        repository.consumeAtomically.mockResolvedValue(true);

        await expect(service.verifyVP(validVP as any, 'req-1', { issueSession: true }))
          .rejects.toThrow(VPVerificationFailedError);
    });
  });

  describe('mapErrorToResponse branches', () => {
    it('returns 404 for ServiceNotFoundError', () => {
        const res = mapErrorToResponse(new ServiceNotFoundError('s1'));
        expect(res.statusCode).toBe(404);
    });

    it('returns 500 for generic error', () => {
        const res = mapErrorToResponse(new Error('boom'));
        expect(res.statusCode).toBe(500);
    });
  });
});

// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VPService, mapErrorToResponse } from '../../../src/services/vp/vp.service.js';
import { 
    VPVerificationFailedError, 
    VPAgentDIDNotFoundError
} from '@helix-id/core';
import { ServiceNotFoundError } from '../../../src/repositories/service-registry.repository.js';

vi.mock('@helix-id/core', async () => {
  const actual = await vi.importActual('@helix-id/core') as any;
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

import { verifySignature } from '@helix-id/core';

describe('VPService Branch Coverage', () => {
  let repository: any;
  let didService: any;
  let vcService: any;
  let serviceRegistry: any;
  let auditLogger: any;
  let service: VPService;

  const validVP = { 
    '@context': ['https://www.w3.org/2018/credentials/v1'],
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
        expirationDate: new Date(Date.now() + 10000).toISOString(),
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

  beforeEach(() => {
    repository = {
      create: vi.fn(),
      findByVpId: vi.fn(),
      consumeAtomically: vi.fn(),
    };
    didService = { resolveDID: vi.fn() };
    vcService = { getVC: vi.fn(), getVCStatus: vi.fn(), findActiveBySubjectDid: vi.fn() };
    serviceRegistry = { assertExists: vi.fn() };
    auditLogger = { log: vi.fn() };
    service = new VPService(repository, didService, vcService, serviceRegistry, auditLogger);
    vi.mocked(verifySignature).mockReset();
  });

  describe('generateVPTemplate branches', () => {
    it('throws VPAgentDIDNotFoundError if agent DID resolution fails', async () => {
        didService.resolveDID.mockRejectedValue(new Error('fail'));
        await expect(service.generateVPTemplate({ agentDid: 'd1', userDid: 'u1', targetService: 's1', vcType: 'HelixAgentCredential' }, 'req-1'))
            .rejects.toThrow(VPAgentDIDNotFoundError);
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
        vp.verifiableCredential[0].expirationDate = new Date(Date.now() - 10000).toISOString();
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

// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentService, mapAgentError } from '../../../src/services/agent/agent.service.js';
import { 
  ChallengeNotFoundError, 
  ChallengeSignatureInvalidError,
  ChallengeExpiredError,
  ChallengeAlreadyVerifiedError,
  EnrollmentTokenNotFoundError,
  EnrollmentTokenAlreadyUsedError,
  EnrollmentTokenExpiredError,
  AgentAlreadyOnboardedError,
  HelixError,
  ErrorCode
} from '@helixid/core';

vi.mock('@helixid/core', async () => {
  const actual = await vi.importActual('@helixid/core') as any;
  return {
    ...actual,
    verifySignature: vi.fn(),
  };
});

import { verifySignature } from '@helixid/core';

describe('AgentService Branch Coverage', () => {
  let repository: any;
  let didService: any;
  let vcService: any;
  let auditLogger: any;
  let service: AgentService;

  beforeEach(() => {
    repository = {
      findChallengeById: vi.fn(),
      markChallengeVerified: vi.fn(),
      listActiveServices: vi.fn(),
      getServiceByName: vi.fn(),
      findServiceByName: vi.fn(),
      createService: vi.fn(),
      createEnrollmentToken: vi.fn(),
      findEnrollmentTokenByHash: vi.fn(),
      burnEnrollmentTokenAtomically: vi.fn(),
      createChallenge: vi.fn(),
      findEnrollmentTokenById: vi.fn(),
    };
    didService = {
      resolveDID: vi.fn(),
      createDID: vi.fn(),
      prepareDIDCreation: vi.fn().mockResolvedValue({ stateJson: '{}', signingPayloadHex: 'ab'.repeat(32) }),
    };
    vcService = { findActiveBySubjectDid: vi.fn(), issueVC: vi.fn() };
    auditLogger = { log: vi.fn() };
    service = new AgentService(repository, didService, vcService, auditLogger);
    vi.mocked(verifySignature).mockReset();
  });

  describe('generateEnrollmentToken branches', () => {
    it('uses empty requestedDomains if not provided', async () => {
        await service.generateEnrollmentToken({ agentName: 'A1', requestedScopes: [] }, 'req-1');
        expect(repository.createEnrollmentToken).toHaveBeenCalledWith(expect.objectContaining({
            requestedDomains: '[]'
        }));
    });
  });

  describe('processOnboardStep1 branches', () => {
    it('throws for invalid public key hex', async () => {
        await expect(service.processOnboardStep1({ enrollmentToken: 't1', publicKeyHex: 'invalid' }, 'req-1'))
          .rejects.toMatchObject({ code: 'INVALID_PUBLIC_KEY' });
    });

    it('throws for invalid domain URL', async () => {
        await expect(service.processOnboardStep1({ enrollmentToken: 't1', publicKeyHex: '0'.repeat(64), domains: ['http://bad.com'] }, 'req-1'))
          .rejects.toMatchObject({ code: 'INVALID_SERVICE_ENDPOINT_URL' });
    });

    it('throws EnrollmentTokenNotFoundError if not found', async () => {
        repository.findEnrollmentTokenByHash.mockResolvedValue(null);
        await expect(service.processOnboardStep1({ enrollmentToken: 't1', publicKeyHex: '0'.repeat(64) }, 'req-1'))
          .rejects.toThrow(EnrollmentTokenNotFoundError);
    });

    it('throws EnrollmentTokenAlreadyUsedError if used', async () => {
        repository.findEnrollmentTokenByHash.mockResolvedValue({ usedAt: new Date() });
        await expect(service.processOnboardStep1({ enrollmentToken: 't1', publicKeyHex: '0'.repeat(64) }, 'req-1'))
          .rejects.toThrow(EnrollmentTokenAlreadyUsedError);
    });

    it('throws EnrollmentTokenExpiredError if expired', async () => {
        repository.findEnrollmentTokenByHash.mockResolvedValue({ expiresAt: new Date(Date.now() - 10000) });
        await expect(service.processOnboardStep1({ enrollmentToken: 't1', publicKeyHex: '0'.repeat(64) }, 'req-1'))
          .rejects.toThrow(EnrollmentTokenExpiredError);
    });

    it('throws EnrollmentTokenAlreadyUsedError if burn fails', async () => {
        repository.findEnrollmentTokenByHash.mockResolvedValue({ expiresAt: new Date(Date.now() + 10000) });
        repository.burnEnrollmentTokenAtomically.mockResolvedValue(false);
        await expect(service.processOnboardStep1({ enrollmentToken: 't1', publicKeyHex: '0'.repeat(64) }, 'req-1'))
          .rejects.toThrow(EnrollmentTokenAlreadyUsedError);
    });
  });

  describe('processOnboardVerify branches', () => {
    it('throws ChallengeNotFoundError if missing or wrong purpose', async () => {
        repository.findChallengeById.mockResolvedValue(null);
        await expect(service.processOnboardVerify({ challengeId: 'c1', signature: '0'.repeat(128) }, 'req-1'))
          .rejects.toThrow(ChallengeNotFoundError);

        repository.findChallengeById.mockResolvedValue({ purpose: 'user_verification' });
        await expect(service.processOnboardVerify({ challengeId: 'c1', signature: '0'.repeat(128) }, 'req-1'))
          .rejects.toThrow(ChallengeNotFoundError);
    });

    it('throws ChallengeExpiredError if expired', async () => {
        repository.findChallengeById.mockResolvedValue({ purpose: 'agent_onboarding', expiresAt: new Date(Date.now() - 10000) });
        await expect(service.processOnboardVerify({ challengeId: 'c1', signature: '0'.repeat(128) }, 'req-1'))
          .rejects.toThrow(ChallengeExpiredError);
    });

    it('throws ChallengeAlreadyVerifiedError if verifiedAt set', async () => {
        repository.findChallengeById.mockResolvedValue({ purpose: 'agent_onboarding', expiresAt: new Date(Date.now() + 10000), verifiedAt: new Date() });
        await expect(service.processOnboardVerify({ challengeId: 'c1', signature: '0'.repeat(128) }, 'req-1'))
          .rejects.toThrow(ChallengeAlreadyVerifiedError);
    });

    it('throws ChallengeSignatureInvalidError if signature format bad', async () => {
        repository.findChallengeById.mockResolvedValue({ purpose: 'agent_onboarding', expiresAt: new Date(Date.now() + 10000) });
        await expect(service.processOnboardVerify({ challengeId: 'c1', signature: 'short' }, 'req-1'))
          .rejects.toThrow(ChallengeSignatureInvalidError);
    });

    it('throws ChallengeSignatureInvalidError if signature verification fails', async () => {
        repository.findChallengeById.mockResolvedValue({ 
            purpose: 'agent_onboarding', 
            expiresAt: new Date(Date.now() + 10000),
            nonce: '00',
            pendingPublicKeyHex: '00'
        });
        vi.mocked(verifySignature).mockResolvedValue(false);
        await expect(service.processOnboardVerify({ challengeId: 'c1', signature: '0'.repeat(128) }, 'req-1'))
          .rejects.toThrow(ChallengeSignatureInvalidError);
    });

    it('throws AgentAlreadyOnboardedError if createDID reports a duplicate DID', async () => {
        repository.findChallengeById.mockResolvedValue({ 
            purpose: 'agent_onboarding', 
            expiresAt: new Date(Date.now() + 10000),
            nonce: '00',
            pendingPublicKeyHex: '00'
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        didService.createDID.mockRejectedValue(new HelixError(ErrorCode.DID_ALREADY_EXISTS, 'conflict', 409));
        await expect(service.processOnboardVerify({ challengeId: 'c1', signature: '0'.repeat(128) }, 'req-1'))
          .rejects.toThrow(AgentAlreadyOnboardedError);
    });

    it('preserves non-duplicate DID creation failures', async () => {
        repository.findChallengeById.mockResolvedValue({
            purpose: 'agent_onboarding',
            expiresAt: new Date(Date.now() + 10000),
            nonce: '00',
            pendingPublicKeyHex: '00'
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        didService.createDID.mockRejectedValue(new HelixError(ErrorCode.HEDERA_ANCHOR_FAILED, 'HCS failed', 502));
        await expect(service.processOnboardVerify({ challengeId: 'c1', signature: '0'.repeat(128) }, 'req-1'))
          .rejects.toMatchObject({ code: ErrorCode.HEDERA_ANCHOR_FAILED, message: 'HCS failed' });
    });

    it('handles onboarding without enrollment token (fallback scopes)', async () => {
        repository.findChallengeById.mockResolvedValue({ 
            purpose: 'agent_onboarding', 
            expiresAt: new Date(Date.now() + 10000),
            nonce: '00',
            pendingPublicKeyHex: '00',
            enrollmentTokenId: null
        });
        vi.mocked(verifySignature).mockResolvedValue(true);
        didService.createDID.mockResolvedValue({ did: 'did:1', hederaTransactionId: 'tx' });
        vcService.issueVC.mockResolvedValue({ vc: {}, vcId: 'v1' });

        const res = await service.processOnboardVerify({ challengeId: 'c1', signature: '0'.repeat(128) }, 'req-1');
        expect(res.agentDid).toBe('did:1');
        expect(vcService.issueVC).toHaveBeenCalledWith(expect.objectContaining({ privilegeScopes: ['read:orders'] }), 'req-1');
    });
  });

  describe('createService branches', () => {
    it('creates service successfully', async () => {
        repository.findServiceByName.mockResolvedValue(null);
        repository.createService.mockResolvedValue({ serviceName: 's1', displayName: 'D', verifiedDomain: 'H', publicKeyMultibase: 'K', apiEndpoint: 'E', metadata: '{}' });
        const res = await service.createService({ serviceName: 's1', displayName: 'D', verifiedDomain: 'https://h.com', publicKeyMultibase: 'K', apiEndpoint: 'https://e.com', metadata: { m: 1 } }, 'req-1');
        expect(res.serviceName).toBe('s1');
    });
  });

  describe('mapAgentError branches', () => {
    it('returns 500 for generic error', () => {
        const res = mapAgentError(new Error('boom'));
        expect(res.statusCode).toBe(500);
    });
  });

  describe('verifyUserChallenge branches', () => {
    it('returns existing VC if found', async () => {
      repository.findChallengeById.mockResolvedValue({ 
        purpose: 'user_verification', 
        expiresAt: new Date(Date.now() + 10000),
        nonce: '00'.repeat(32),
        did: 'did:1'
      });
      didService.resolveDID.mockResolvedValue({ verificationMethod: [{ type: 'Ed25519VerificationKey2020', publicKeyHex: '00'.repeat(32) }] });
      vi.mocked(verifySignature).mockResolvedValue(true);
      vcService.findActiveBySubjectDid.mockResolvedValue({ id: 'vc-active' });

      const res = await service.verifyUserChallenge('c1', { signature: '0'.repeat(128) }, 'req-1');
      expect(res.vc?.id).toBe('vc-active');
    });

    it('issues a user VC if none exists after challenge verification', async () => {
      repository.findChallengeById.mockResolvedValue({
        purpose: 'user_verification',
        expiresAt: new Date(Date.now() + 10000),
        nonce: '00'.repeat(32),
        did: 'did:hedera:testnet:user-1'
      });
      didService.resolveDID.mockResolvedValue({
        verificationMethod: [{ type: 'Ed25519VerificationKey2020', publicKeyHex: '00'.repeat(32) }]
      });
      vi.mocked(verifySignature).mockResolvedValue(true);
      vcService.findActiveBySubjectDid.mockResolvedValue(null);
      vcService.issueVC.mockResolvedValue({ vc: { id: 'new-vc' } });

      const res = await service.verifyUserChallenge('c1', { signature: '0'.repeat(128) }, 'req-1');

      expect(repository.markChallengeVerified).toHaveBeenCalledWith('c1');
      expect(vcService.issueVC).toHaveBeenCalledWith({
        subjectDid: 'did:hedera:testnet:user-1',
        subjectType: 'user',
        userId: 'did:hedera:testnet:user-1',
        expiresInSeconds: 7_776_000
      }, 'req-1');
      expect(res).toEqual({
        did: 'did:hedera:testnet:user-1',
        verified: true,
        vc: { id: 'new-vc' }
      });
    });
  });
});

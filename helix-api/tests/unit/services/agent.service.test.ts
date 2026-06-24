// Copyright 2026 DgVerse LLP
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AgentService } from '../../../src/services/agent/agent.service.js';
import { 
  ServiceNotFoundError,
  ServiceAlreadyExistsError
} from '@helixid/core';

describe('AgentService Unit Tests', () => {
  let repository: any;
  let didService: any;
  let vcService: any;
  let auditLogger: any;
  let agentService: AgentService;

  beforeEach(() => {
    repository = {
      findServiceByName: vi.fn(),
      createService: vi.fn(),
      findEnrollmentTokenByHash: vi.fn(),
      findEnrollmentTokenById: vi.fn(),
      burnEnrollmentTokenAtomically: vi.fn(),
      createChallenge: vi.fn(),
      findChallengeById: vi.fn(),
      markChallengeVerified: vi.fn(),
      getServiceByName: vi.fn(),
      listActiveServices: vi.fn(),
      createEnrollmentToken: vi.fn(),
    };
    didService = {
      createDID: vi.fn(),
      resolveDID: vi.fn(),
      prepareDIDCreation: vi.fn().mockResolvedValue({ stateJson: '{}', signingPayloadHex: 'ab'.repeat(32) }),
    };
    vcService = { issueVC: vi.fn(), findActiveBySubjectDid: vi.fn() };
    auditLogger = { log: vi.fn() };

    agentService = new AgentService(
      repository,
      didService,
      vcService,
      auditLogger
    );
  });

  describe('generateEnrollmentToken', () => {
    it('successfully generates and persists a token', async () => {
      const result = await agentService.generateEnrollmentToken({ 
        agentName: 'test', 
        requestedScopes: ['read'],
        requestedDomains: ['https://example.com']
      }, 'req-1');
      expect(result.token).toBeDefined();
      expect(repository.createEnrollmentToken).toHaveBeenCalled();
    });
  });

  describe('processOnboardStep1', () => {
    const rawToken = 'enroll:abc';
    const publicKeyHex = 'a'.repeat(64);

    it('throws VALIDATION_ERROR for invalid public key', async () => {
      await expect(agentService.processOnboardStep1({ enrollmentToken: rawToken, publicKeyHex: 'short', domains: [] }, 'req-1'))
        .rejects.toMatchObject({ code: 'INVALID_PUBLIC_KEY' });
    });

    it('throws INVALID_SERVICE_ENDPOINT_URL for non-https domain', async () => {
      await expect(agentService.processOnboardStep1({ enrollmentToken: rawToken, publicKeyHex, domains: ['http://unsafe.com'] }, 'req-1'))
        .rejects.toMatchObject({ code: 'INVALID_SERVICE_ENDPOINT_URL' });
    });
  });

  describe('issueUserChallenge', () => {
    it('successfully creates a user challenge', async () => {
      didService.resolveDID.mockResolvedValue({});
      const result = await agentService.issueUserChallenge({ did: 'did:1', purpose: 'user_verification' }, 'req-1');
      expect(result.challengeId).toBeDefined();
      expect(repository.createChallenge).toHaveBeenCalled();
    });
  });

  describe('getService', () => {
    it('throws ServiceNotFoundError if missing', async () => {
      repository.getServiceByName.mockResolvedValue(null);
      await expect(agentService.getService('missing')).rejects.toThrow(ServiceNotFoundError);
    });

    it('returns service entry if found', async () => {
      repository.getServiceByName.mockResolvedValue({ 
        serviceName: 's1', 
        displayName: 'S1', 
        verifiedDomain: 'https://s1.com', 
        publicKeyMultibase: 'z1', 
        apiEndpoint: 'https://api.s1.com', 
        metadata: '{}' 
      });
      const result = await agentService.getService('s1');
      expect(result.serviceName).toBe('s1');
    });
  });

  describe('createService', () => {
    it('throws VALIDATION_ERROR for invalid service name', async () => {
      await expect(agentService.createService({ serviceName: 'BAD', displayName: 'D', verifiedDomain: 'https://v', publicKeyMultibase: 'z', apiEndpoint: 'https://a', metadata: {} }, 'req-1'))
        .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('throws ServiceAlreadyExistsError if name taken', async () => {
      repository.findServiceByName.mockResolvedValue({ id: '1' });
      await expect(agentService.createService({ serviceName: 'taken', displayName: 'D', verifiedDomain: 'https://v', publicKeyMultibase: 'z', apiEndpoint: 'https://a', metadata: {} }, 'req-1'))
        .rejects.toThrow(ServiceAlreadyExistsError);
    });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AgentService, mapAgentError } from '../../../src/services/agent/agent.service.js';
import { ServiceAlreadyExistsError } from '@helix-id/core';

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
    };
    didService = {};
    vcService = {};
    auditLogger = { log: vi.fn() };

    agentService = new AgentService(
      repository,
      didService,
      vcService,
      auditLogger
    );
  });

  describe('createService', () => {
    it('throws ServiceAlreadyExistsError if service exists', async () => {
      repository.findServiceByName.mockResolvedValue({ id: '1' });

      await expect(agentService.createService({
        serviceName: 'amazon',
        displayName: 'Amazon',
        verifiedDomain: 'https://amazon.com',
        apiEndpoint: 'https://api.amazon.com',
        publicKeyMultibase: 'z123',
        metadata: {}
      }, 'req-1')).rejects.toThrow(ServiceAlreadyExistsError);
    });
  });

  describe('mapAgentError', () => {
    it('returns 500 for unknown error types', () => {
      const error = new Error('Unknown');
      const response = mapAgentError(error);
      expect(response.statusCode).toBe(500);
      expect(response.code).toBe('INTERNAL_ERROR');
    });
  });
});

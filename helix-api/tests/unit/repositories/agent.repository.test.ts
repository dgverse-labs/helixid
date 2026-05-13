import { describe, expect, it, beforeEach } from 'vitest';
import { AgentRepository } from '../../../src/repositories/agent.repository.js';

describe('AgentRepository Unit Tests', () => {
  let repository: AgentRepository;

  beforeEach(() => {
    repository = new AgentRepository();
  });

  describe('markChallengeVerified', () => {
    it('throws error if challenge not found', async () => {
      await expect(repository.markChallengeVerified('unknown')).rejects.toThrow('Challenge not found');
    });
  });

  describe('getServiceByName', () => {
    it('returns null if service is not found', async () => {
      const result = await repository.getServiceByName('unknown');
      expect(result).toBeNull();
    });

    it('returns null if service is found but inactive', async () => {
      await repository.createService({
        serviceName: 'inactive-svc',
        displayName: 'Inactive',
        verifiedDomain: 'https://inactive.com',
        publicKeyMultibase: 'z123',
        apiEndpoint: 'https://api.inactive.com',
        metadata: '{}'
      });
      
      // Manually set to inactive in our in-memory map
      const service = (repository as any).services.get('inactive-svc');
      service.active = false;

      const result = await repository.getServiceByName('inactive-svc');
      expect(result).toBeNull();
    });
  });
});

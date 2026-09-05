import { describe, expect, it } from 'vitest';
import { AgentRepository } from '../../../src/repositories/agent.repository.js';
import {
  BUILT_IN_SERVICES,
  ServiceNotFoundError,
  ServiceRegistryRepository,
} from '../../../src/repositories/service-registry.repository.js';

describe('ServiceRegistryRepository', () => {
  it('checks VP targets against services created in the DB-backed registry path', async () => {
    const agentRepository = new AgentRepository();
    const registry = new ServiceRegistryRepository(agentRepository);

    await agentRepository.createService({
      serviceName: 'orders-service',
      displayName: 'Orders Service',
      verifiedDomain: 'https://orders.example.com',
      publicKeyMultibase: 'z123',
      apiEndpoint: 'https://orders.example.com/verify',
      metadata: '{}',
    });

    await expect(registry.assertExists('orders-service')).resolves.toBeUndefined();
    await expect(registry.assertExists('missing-service')).rejects.toThrow(ServiceNotFoundError);
  });

  it('seeds built-in VP targets as active registry rows', async () => {
    const agentRepository = new AgentRepository();
    const registry = new ServiceRegistryRepository(agentRepository);

    await registry.seedBuiltIns();

    for (const service of BUILT_IN_SERVICES) {
      await expect(registry.assertExists(service.serviceName)).resolves.toBeUndefined();
    }
  });
});

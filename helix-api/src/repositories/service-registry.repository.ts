import type { AgentRepository, ServiceRegistryRecord } from './agent.repository.js';

type ServiceRegistryStore = Pick<
  AgentRepository,
  'getServiceByName' | 'upsertService'
>;

export const BUILT_IN_SERVICES: Array<
  Omit<ServiceRegistryRecord, 'id' | 'active' | 'createdAt' | 'updatedAt'>
> = [
  {
    serviceName: 'amazon',
    displayName: 'Amazon Retail',
    verifiedDomain: 'https://amazon.com',
    publicKeyMultibase: 'z6MkgYvYFsCcNycDE9iJ6shfX88oZ3LGH5x9R673d39R',
    apiEndpoint: 'https://api.amazon.com/helix-verify',
    metadata: '{}',
  },
  {
    serviceName: 'helix-delegation',
    displayName: 'Helix Delegation',
    verifiedDomain: 'https://helixid.io',
    publicKeyMultibase: 'z6MkgYvYFsCcNycDE9iJ6shfX88oZ3LGH5x9R673d39R',
    apiEndpoint: 'https://api.helixid.io/helix-delegation',
    metadata: '{}',
  },
];

export class ServiceNotFoundError extends Error {
  constructor(public readonly service: string) {
    super(`Service not found: ${service}`);
    this.name = 'ServiceNotFoundError';
  }
}

export class ServiceRegistryRepository {
  constructor(private readonly store: ServiceRegistryStore) {}

  async assertExists(service: string): Promise<void> {
    const record = await this.store.getServiceByName(service);
    if (!record) {
      throw new ServiceNotFoundError(service);
    }
  }

  async seedBuiltIns(): Promise<void> {
    for (const service of BUILT_IN_SERVICES) {
      await this.store.upsertService(service);
    }
  }
}

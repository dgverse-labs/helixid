export class ServiceNotFoundError extends Error {
  constructor(public readonly service: string) {
    super(`Service not found: ${service}`);
    this.name = 'ServiceNotFoundError';
  }
}

export class ServiceRegistryRepository {
  private readonly services: Set<string>;

  constructor(seedServices: string[] = ['amazon']) {
    this.services = new Set(seedServices);
  }

  async assertExists(service: string): Promise<void> {
    if (!this.services.has(service)) {
      throw new ServiceNotFoundError(service);
    }
  }
}

import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import type { StorageDriverKind } from '../storage/driver-registry.js';
import { createAgentStorageDriver, type AgentStorageDriver } from './drivers/agent.drivers.js';

export interface EnrollmentTokenRecord {
  id: string;
  tokenHash: string;
  agentName: string;
  requestedScopes: string;
  requestedDomains: string;
  maxDelegationDepth?: number;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface ChallengeRecord {
  id: string;
  challengeId: string;
  nonce: string;
  did: string;
  purpose: 'agent_onboarding' | 'user_verification';
  pendingPublicKeyHex: string | null;
  pendingDomains: string | null;
  pendingDidCreateStateJson?: string | null | undefined;
  pendingDidCreatePayloadHex?: string | null | undefined;
  expiresAt: Date;
  verifiedAt: Date | null;
  createdAt: Date;
  enrollmentTokenId: string | null;
}

export interface ServiceRegistryRecord {
  id: string;
  serviceName: string;
  displayName: string;
  verifiedDomain: string;
  publicKeyMultibase: string;
  apiEndpoint: string;
  metadata: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * AgentRepository is a thin delegator over an AgentStorageDriver — see
 * storage/driver-registry.ts for the pattern and
 * repositories/drivers/did.drivers.ts for the reference implementation.
 * Covers three sub-domains (enrollment tokens, onboarding/user challenges,
 * service registry) in one driver interface, matching how this repository
 * was already structured as a single class before this refactor.
 *
 * The (prisma?, sqlite?) constructor signature is unchanged on purpose —
 * see did.repository.ts's class doc comment for the full rationale.
 */
export class AgentRepository {
  private readonly driver: AgentStorageDriver;

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {
    this.driver = createAgentStorageDriver(this.resolveDriverKind(), { prisma, sqlite });
  }

  private resolveDriverKind(): StorageDriverKind {
    if (this.prisma) return 'postgres';
    if (this.sqlite) return 'sqlite';
    return 'memory';
  }

  async createEnrollmentToken(
    data: Omit<EnrollmentTokenRecord, 'id' | 'usedAt' | 'createdAt' | 'maxDelegationDepth'> & {
      maxDelegationDepth?: number;
    },
  ): Promise<EnrollmentTokenRecord> {
    return this.driver.createEnrollmentToken(data);
  }

  async findEnrollmentTokenByHash(tokenHash: string): Promise<EnrollmentTokenRecord | null> {
    return this.driver.findEnrollmentTokenByHash(tokenHash);
  }

  async findEnrollmentTokenById(id: string): Promise<EnrollmentTokenRecord | null> {
    return this.driver.findEnrollmentTokenById(id);
  }

  async burnEnrollmentTokenAtomically(tokenHash: string): Promise<boolean> {
    return this.driver.burnEnrollmentTokenAtomically(tokenHash);
  }

  async createChallenge(
    data: Omit<ChallengeRecord, 'id' | 'verifiedAt' | 'createdAt'>,
  ): Promise<ChallengeRecord> {
    return this.driver.createChallenge(data);
  }

  async findChallengeById(challengeId: string): Promise<ChallengeRecord | null> {
    return this.driver.findChallengeById(challengeId);
  }

  async markChallengeVerified(challengeId: string): Promise<ChallengeRecord> {
    return this.driver.markChallengeVerified(challengeId);
  }

  async createService(
    data: Omit<ServiceRegistryRecord, 'id' | 'active' | 'createdAt' | 'updatedAt'>,
  ): Promise<ServiceRegistryRecord> {
    return this.driver.createService(data);
  }

  async upsertService(
    data: Omit<ServiceRegistryRecord, 'id' | 'active' | 'createdAt' | 'updatedAt'>,
  ): Promise<ServiceRegistryRecord> {
    return this.driver.upsertService(data);
  }

  async getServiceByName(serviceName: string): Promise<ServiceRegistryRecord | null> {
    return this.driver.getServiceByName(serviceName);
  }

  async findServiceByName(serviceName: string): Promise<ServiceRegistryRecord | null> {
    return this.driver.findServiceByName(serviceName);
  }

  async listActiveServices(): Promise<ServiceRegistryRecord[]> {
    return this.driver.listActiveServices();
  }
}

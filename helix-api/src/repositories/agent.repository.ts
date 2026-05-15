import type { PrismaClient } from '@prisma/client';

export interface EnrollmentTokenRecord {
  id: string;
  tokenHash: string;
  agentName: string;
  requestedScopes: string;
  requestedDomains: string;
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

function makeId(prefix: string): string {
  return `${prefix}:${Math.random().toString(16).slice(2, 14)}`;
}

export class AgentRepository {
  private readonly enrollmentTokens = new Map<string, EnrollmentTokenRecord>();
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly services = new Map<string, ServiceRegistryRecord>();

  constructor(private readonly prisma?: PrismaClient) {}

  async createEnrollmentToken(
    data: Omit<EnrollmentTokenRecord, 'id' | 'usedAt' | 'createdAt'>
  ): Promise<EnrollmentTokenRecord> {
    if (this.prisma) {
      return this.prisma.enrollmentToken.create({
        data
      });
    }

    const record: EnrollmentTokenRecord = {
      id: makeId('et'),
      ...data,
      usedAt: null,
      createdAt: new Date()
    };
    this.enrollmentTokens.set(record.tokenHash, record);
    return record;
  }

  async findEnrollmentTokenByHash(tokenHash: string): Promise<EnrollmentTokenRecord | null> {
    if (this.prisma) {
      return this.prisma.enrollmentToken.findUnique({ where: { tokenHash } });
    }

    return this.enrollmentTokens.get(tokenHash) ?? null;
  }

  async findEnrollmentTokenById(id: string): Promise<EnrollmentTokenRecord | null> {
    if (this.prisma) {
      return this.prisma.enrollmentToken.findUnique({ where: { id } });
    }

    for (const token of this.enrollmentTokens.values()) {
      if (token.id === id) {
        return token;
      }
    }
    return null;
  }

  async burnEnrollmentTokenAtomically(tokenHash: string): Promise<boolean> {
    if (this.prisma) {
      const result = await this.prisma.enrollmentToken.updateMany({
        where: { tokenHash, usedAt: null },
        data: { usedAt: new Date() }
      });
      return result.count === 1;
    }

    const token = this.enrollmentTokens.get(tokenHash);
    if (!token || token.usedAt) {
      return false;
    }
    token.usedAt = new Date();
    this.enrollmentTokens.set(tokenHash, token);
    return true;
  }

  async createChallenge(
    data: Omit<ChallengeRecord, 'id' | 'verifiedAt' | 'createdAt'>
  ): Promise<ChallengeRecord> {
    if (this.prisma) {
      return this.prisma.challenge.create({
        data
      }) as Promise<ChallengeRecord>;
    }

    const record: ChallengeRecord = {
      id: makeId('chdb'),
      ...data,
      verifiedAt: null,
      createdAt: new Date()
    };
    this.challenges.set(record.challengeId, record);
    return record;
  }

  async findChallengeById(challengeId: string): Promise<ChallengeRecord | null> {
    if (this.prisma) {
      return this.prisma.challenge.findUnique({ where: { challengeId } }) as Promise<ChallengeRecord | null>;
    }

    return this.challenges.get(challengeId) ?? null;
  }

  async markChallengeVerified(challengeId: string): Promise<ChallengeRecord> {
    if (this.prisma) {
      return this.prisma.challenge.update({
        where: { challengeId },
        data: { verifiedAt: new Date() }
      }) as Promise<ChallengeRecord>;
    }

    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      throw new Error('Challenge not found');
    }
    challenge.verifiedAt = new Date();
    this.challenges.set(challengeId, challenge);
    return challenge;
  }

  async createService(
    data: Omit<ServiceRegistryRecord, 'id' | 'active' | 'createdAt' | 'updatedAt'>
  ): Promise<ServiceRegistryRecord> {
    if (this.prisma) {
      return this.prisma.serviceRegistry.create({
        data
      });
    }

    const now = new Date();
    const record: ServiceRegistryRecord = {
      id: makeId('svc'),
      ...data,
      active: true,
      createdAt: now,
      updatedAt: now
    };
    this.services.set(record.serviceName, record);
    return record;
  }

  async getServiceByName(serviceName: string): Promise<ServiceRegistryRecord | null> {
    if (this.prisma) {
      return this.prisma.serviceRegistry.findFirst({ where: { serviceName, active: true } });
    }

    const service = this.services.get(serviceName);
    if (!service || !service.active) {
      return null;
    }
    return service;
  }

  async findServiceByName(serviceName: string): Promise<ServiceRegistryRecord | null> {
    if (this.prisma) {
      return this.prisma.serviceRegistry.findUnique({ where: { serviceName } });
    }

    return this.services.get(serviceName) ?? null;
  }

  async listActiveServices(): Promise<ServiceRegistryRecord[]> {
    if (this.prisma) {
      return this.prisma.serviceRegistry.findMany({ where: { active: true } });
    }

    return [...this.services.values()].filter((service) => service.active);
  }
}

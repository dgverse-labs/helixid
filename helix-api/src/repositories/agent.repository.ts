import type { PrismaClient } from '@prisma/client';

type PrismaRaw = PrismaClient & {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

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

function makeId(prefix: string): string {
  return `${prefix}:${Math.random().toString(16).slice(2, 14)}`;
}

function toChallengeRecord(row: ChallengeRecord): ChallengeRecord {
  return {
    id: row.id,
    challengeId: row.challengeId,
    nonce: row.nonce,
    did: row.did,
    purpose: row.purpose,
    pendingPublicKeyHex: row.pendingPublicKeyHex,
    pendingDomains: row.pendingDomains,
    pendingDidCreateStateJson: row.pendingDidCreateStateJson,
    pendingDidCreatePayloadHex: row.pendingDidCreatePayloadHex,
    expiresAt: row.expiresAt,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    enrollmentTokenId: row.enrollmentTokenId,
  };
}

function requireChallengeRow(row: ChallengeRecord | undefined): ChallengeRecord {
  if (!row) {
    throw new Error('Challenge query returned no rows');
  }
  return row;
}

function requireEnrollmentTokenRow(row: EnrollmentTokenRecord | undefined): EnrollmentTokenRecord {
  if (!row) {
    throw new Error('Enrollment token query returned no rows');
  }
  return row;
}

function hasRealRaw(prisma: PrismaClient): boolean {
  return typeof (prisma as Partial<PrismaRaw>).$queryRawUnsafe === 'function'
    && typeof (prisma as { $connect?: unknown }).$connect === 'function';
}

export class AgentRepository {
  private readonly enrollmentTokens = new Map<string, EnrollmentTokenRecord>();
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly services = new Map<string, ServiceRegistryRecord>();

  constructor(private readonly prisma?: PrismaClient) {}

  async createEnrollmentToken(
    data: Omit<EnrollmentTokenRecord, 'id' | 'usedAt' | 'createdAt' | 'maxDelegationDepth'> & { maxDelegationDepth?: number }
  ): Promise<EnrollmentTokenRecord> {
    if (this.prisma) {
      const record = await this.prisma.enrollmentToken.create({
        data: {
          tokenHash: data.tokenHash,
          agentName: data.agentName,
          requestedScopes: data.requestedScopes,
          requestedDomains: data.requestedDomains,
          expiresAt: data.expiresAt,
        }
      }) as EnrollmentTokenRecord;
      if ((data.maxDelegationDepth ?? 0) > 0 && hasRealRaw(this.prisma)) {
        const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<EnrollmentTokenRecord[]>(
          `UPDATE "enrollment_tokens" SET "maxDelegationDepth" = $1 WHERE "id" = $2 RETURNING *`,
          data.maxDelegationDepth ?? 0,
          record.id,
        );
        return requireEnrollmentTokenRow(rows[0]);
      }
      return data.maxDelegationDepth === undefined
        ? record
        : { ...record, maxDelegationDepth: data.maxDelegationDepth ?? record.maxDelegationDepth ?? 0 };
    }

    const record: EnrollmentTokenRecord = {
      id: makeId('et'),
      ...data,
      maxDelegationDepth: data.maxDelegationDepth ?? 0,
      usedAt: null,
      createdAt: new Date()
    };
    this.enrollmentTokens.set(record.tokenHash, record);
    return record;
  }

  async findEnrollmentTokenByHash(tokenHash: string): Promise<EnrollmentTokenRecord | null> {
    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<EnrollmentTokenRecord[]>(
        `SELECT * FROM "enrollment_tokens" WHERE "tokenHash" = $1 LIMIT 1`,
        tokenHash,
      );
      return rows[0] ? rows[0] : null;
    }
    if (this.prisma) {
      return this.prisma.enrollmentToken.findUnique({ where: { tokenHash } }) as Promise<EnrollmentTokenRecord | null>;
    }

    return this.enrollmentTokens.get(tokenHash) ?? null;
  }

  async findEnrollmentTokenById(id: string): Promise<EnrollmentTokenRecord | null> {
    if (this.prisma && hasRealRaw(this.prisma)) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<EnrollmentTokenRecord[]>(
        `SELECT * FROM "enrollment_tokens" WHERE "id" = $1 LIMIT 1`,
        id,
      );
      return rows[0] ? rows[0] : null;
    }
    if (this.prisma) {
      return this.prisma.enrollmentToken.findUnique({ where: { id } }) as Promise<EnrollmentTokenRecord | null>;
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
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<ChallengeRecord[]>(
        `INSERT INTO "challenges" (
          "id",
          "challengeId",
          "nonce",
          "did",
          "purpose",
          "pendingPublicKeyHex",
          "pendingDomains",
          "pendingDidCreateStateJson",
          "pendingDidCreatePayloadHex",
          "expiresAt",
          "enrollmentTokenId"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *`,
        makeId('chdb'),
        data.challengeId,
        data.nonce,
        data.did,
        data.purpose,
        data.pendingPublicKeyHex,
        data.pendingDomains,
        data.pendingDidCreateStateJson ?? null,
        data.pendingDidCreatePayloadHex ?? null,
        data.expiresAt,
        data.enrollmentTokenId,
      );
      return toChallengeRecord(requireChallengeRow(rows[0]));
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
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<ChallengeRecord[]>(
        `SELECT * FROM "challenges" WHERE "challengeId" = $1 LIMIT 1`,
        challengeId,
      );
      return rows[0] ? toChallengeRecord(rows[0]) : null;
    }

    return this.challenges.get(challengeId) ?? null;
  }

  async markChallengeVerified(challengeId: string): Promise<ChallengeRecord> {
    if (this.prisma) {
      const rows = await (this.prisma as PrismaRaw).$queryRawUnsafe<ChallengeRecord[]>(
        `UPDATE "challenges" SET "verifiedAt" = $1 WHERE "challengeId" = $2 RETURNING *`,
        new Date(),
        challengeId,
      );
      return toChallengeRecord(requireChallengeRow(rows[0]));
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

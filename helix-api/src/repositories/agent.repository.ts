import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

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

type SqliteEnrollmentTokenRow = {
  id: string;
  token_hash: string;
  agent_name: string;
  requested_scopes: string;
  requested_domains: string;
  max_delegation_depth: number;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

type SqliteChallengeRow = {
  id: string;
  challenge_id: string;
  nonce: string;
  did: string;
  purpose: 'agent_onboarding' | 'user_verification';
  pending_public_key_hex: string | null;
  pending_domains: string | null;
  pending_did_create_state_json: string | null;
  pending_did_create_payload_hex: string | null;
  expires_at: string;
  verified_at: string | null;
  created_at: string;
  enrollment_token_id: string | null;
};

type SqliteServiceRow = {
  id: string;
  service_name: string;
  display_name: string;
  verified_domain: string;
  public_key_multibase: string;
  api_endpoint: string;
  metadata: string;
  active: number;
  created_at: string;
  updated_at: string;
};

function fromEnrollmentTokenRow(
  row: SqliteEnrollmentTokenRow | undefined,
): EnrollmentTokenRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    tokenHash: row.token_hash,
    agentName: row.agent_name,
    requestedScopes: row.requested_scopes,
    requestedDomains: row.requested_domains,
    maxDelegationDepth: row.max_delegation_depth,
    expiresAt: new Date(row.expires_at),
    usedAt: row.used_at ? new Date(row.used_at) : null,
    createdAt: new Date(row.created_at),
  };
}

function fromChallengeRow(row: SqliteChallengeRow | undefined): ChallengeRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    challengeId: row.challenge_id,
    nonce: row.nonce,
    did: row.did,
    purpose: row.purpose,
    pendingPublicKeyHex: row.pending_public_key_hex,
    pendingDomains: row.pending_domains,
    pendingDidCreateStateJson: row.pending_did_create_state_json,
    pendingDidCreatePayloadHex: row.pending_did_create_payload_hex,
    expiresAt: new Date(row.expires_at),
    verifiedAt: row.verified_at ? new Date(row.verified_at) : null,
    createdAt: new Date(row.created_at),
    enrollmentTokenId: row.enrollment_token_id,
  };
}

function fromServiceRow(row: SqliteServiceRow | undefined): ServiceRegistryRecord | null {
  if (!row) return null;
  return {
    id: row.id,
    serviceName: row.service_name,
    displayName: row.display_name,
    verifiedDomain: row.verified_domain,
    publicKeyMultibase: row.public_key_multibase,
    apiEndpoint: row.api_endpoint,
    metadata: row.metadata,
    active: row.active === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
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
  return (
    typeof (prisma as Partial<PrismaRaw>).$queryRawUnsafe === 'function' &&
    typeof (prisma as { $connect?: unknown }).$connect === 'function'
  );
}

export class AgentRepository {
  private readonly enrollmentTokens = new Map<string, EnrollmentTokenRecord>();
  private readonly challenges = new Map<string, ChallengeRecord>();
  private readonly services = new Map<string, ServiceRegistryRecord>();

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {}

  async createEnrollmentToken(
    data: Omit<EnrollmentTokenRecord, 'id' | 'usedAt' | 'createdAt' | 'maxDelegationDepth'> & {
      maxDelegationDepth?: number;
    },
  ): Promise<EnrollmentTokenRecord> {
    if (this.prisma) {
      const record = (await this.prisma.enrollmentToken.create({
        data: {
          tokenHash: data.tokenHash,
          agentName: data.agentName,
          requestedScopes: data.requestedScopes,
          requestedDomains: data.requestedDomains,
          expiresAt: data.expiresAt,
        },
      })) as EnrollmentTokenRecord;
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
        : {
            ...record,
            maxDelegationDepth: data.maxDelegationDepth ?? record.maxDelegationDepth ?? 0,
          };
    }

    if (this.sqlite) {
      const id = makeId('et');
      const now = new Date();
      const maxDepth = data.maxDelegationDepth ?? 0;
      this.sqlite.execute(`
        INSERT INTO enrollment_tokens (
          id, token_hash, agent_name, requested_scopes, requested_domains,
          max_delegation_depth, expires_at, used_at, created_at
        ) VALUES (
          ${sqliteLiteral(id)},
          ${sqliteLiteral(data.tokenHash)},
          ${sqliteLiteral(data.agentName)},
          ${sqliteLiteral(data.requestedScopes)},
          ${sqliteLiteral(data.requestedDomains)},
          ${sqliteLiteral(maxDepth)},
          ${sqliteLiteral(data.expiresAt)},
          NULL,
          ${sqliteLiteral(now)}
        )
      `);
      return {
        id,
        ...data,
        maxDelegationDepth: maxDepth,
        usedAt: null,
        createdAt: now,
      };
    }

    const record: EnrollmentTokenRecord = {
      id: makeId('et'),
      ...data,
      maxDelegationDepth: data.maxDelegationDepth ?? 0,
      usedAt: null,
      createdAt: new Date(),
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
      return this.prisma.enrollmentToken.findUnique({
        where: { tokenHash },
      }) as Promise<EnrollmentTokenRecord | null>;
    }
    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteEnrollmentTokenRow>(`
        SELECT * FROM enrollment_tokens WHERE token_hash = ${sqliteLiteral(tokenHash)} LIMIT 1
      `);
      return fromEnrollmentTokenRow(rows[0]);
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
      return this.prisma.enrollmentToken.findUnique({
        where: { id },
      }) as Promise<EnrollmentTokenRecord | null>;
    }
    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteEnrollmentTokenRow>(`
        SELECT * FROM enrollment_tokens WHERE id = ${sqliteLiteral(id)} LIMIT 1
      `);
      return fromEnrollmentTokenRow(rows[0]);
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
        data: { usedAt: new Date() },
      });
      return result.count === 1;
    }

    if (this.sqlite) {
      const now = new Date();
      this.sqlite.execute(`
        UPDATE enrollment_tokens
        SET used_at = ${sqliteLiteral(now)}
        WHERE token_hash = ${sqliteLiteral(tokenHash)}
          AND used_at IS NULL
      `);
      const token = await this.findEnrollmentTokenByHash(tokenHash);
      return Boolean(token?.usedAt && token.usedAt.getTime() === now.getTime());
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
    data: Omit<ChallengeRecord, 'id' | 'verifiedAt' | 'createdAt'>,
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

    if (this.sqlite) {
      const id = makeId('chdb');
      const now = new Date();
      this.sqlite.execute(`
        INSERT INTO challenges (
          id, challenge_id, nonce, did, purpose, pending_public_key_hex,
          pending_domains, pending_did_create_state_json, pending_did_create_payload_hex,
          expires_at, verified_at, created_at, enrollment_token_id
        ) VALUES (
          ${sqliteLiteral(id)},
          ${sqliteLiteral(data.challengeId)},
          ${sqliteLiteral(data.nonce)},
          ${sqliteLiteral(data.did)},
          ${sqliteLiteral(data.purpose)},
          ${sqliteLiteral(data.pendingPublicKeyHex)},
          ${sqliteLiteral(data.pendingDomains)},
          ${sqliteLiteral(data.pendingDidCreateStateJson ?? null)},
          ${sqliteLiteral(data.pendingDidCreatePayloadHex ?? null)},
          ${sqliteLiteral(data.expiresAt)},
          NULL,
          ${sqliteLiteral(now)},
          ${sqliteLiteral(data.enrollmentTokenId)}
        )
      `);
      return {
        id,
        ...data,
        verifiedAt: null,
        createdAt: now,
      };
    }

    const record: ChallengeRecord = {
      id: makeId('chdb'),
      ...data,
      verifiedAt: null,
      createdAt: new Date(),
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

    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteChallengeRow>(`
        SELECT * FROM challenges WHERE challenge_id = ${sqliteLiteral(challengeId)} LIMIT 1
      `);
      return fromChallengeRow(rows[0]);
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

    if (this.sqlite) {
      const now = new Date();
      this.sqlite.execute(`
        UPDATE challenges
        SET verified_at = ${sqliteLiteral(now)}
        WHERE challenge_id = ${sqliteLiteral(challengeId)}
      `);
      const challenge = await this.findChallengeById(challengeId);
      if (!challenge) throw new Error('Challenge not found');
      return challenge;
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
    data: Omit<ServiceRegistryRecord, 'id' | 'active' | 'createdAt' | 'updatedAt'>,
  ): Promise<ServiceRegistryRecord> {
    if (this.prisma) {
      return this.prisma.serviceRegistry.create({
        data,
      });
    }

    if (this.sqlite) {
      const id = makeId('svc');
      const now = new Date();
      this.sqlite.execute(`
        INSERT INTO service_registry (
          id, service_name, display_name, verified_domain,
          public_key_multibase, api_endpoint, metadata, active, created_at, updated_at
        ) VALUES (
          ${sqliteLiteral(id)},
          ${sqliteLiteral(data.serviceName)},
          ${sqliteLiteral(data.displayName)},
          ${sqliteLiteral(data.verifiedDomain)},
          ${sqliteLiteral(data.publicKeyMultibase)},
          ${sqliteLiteral(data.apiEndpoint)},
          ${sqliteLiteral(data.metadata)},
          1,
          ${sqliteLiteral(now)},
          ${sqliteLiteral(now)}
        )
      `);
      return {
        id,
        ...data,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
    }

    const now = new Date();
    const record: ServiceRegistryRecord = {
      id: makeId('svc'),
      ...data,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    this.services.set(record.serviceName, record);
    return record;
  }

  async getServiceByName(serviceName: string): Promise<ServiceRegistryRecord | null> {
    if (this.prisma) {
      return this.prisma.serviceRegistry.findFirst({ where: { serviceName, active: true } });
    }

    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteServiceRow>(`
        SELECT * FROM service_registry
        WHERE service_name = ${sqliteLiteral(serviceName)}
          AND active = 1
        LIMIT 1
      `);
      return fromServiceRow(rows[0]);
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

    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteServiceRow>(`
        SELECT * FROM service_registry
        WHERE service_name = ${sqliteLiteral(serviceName)}
        LIMIT 1
      `);
      return fromServiceRow(rows[0]);
    }

    return this.services.get(serviceName) ?? null;
  }

  async listActiveServices(): Promise<ServiceRegistryRecord[]> {
    if (this.prisma) {
      return this.prisma.serviceRegistry.findMany({ where: { active: true } });
    }

    if (this.sqlite) {
      const rows = this.sqlite.query<SqliteServiceRow>(`
        SELECT * FROM service_registry WHERE active = 1
      `);
      return rows
        .map((row) => fromServiceRow(row))
        .filter((v): v is ServiceRegistryRecord => Boolean(v));
    }

    return [...this.services.values()].filter((service) => service.active);
  }
}

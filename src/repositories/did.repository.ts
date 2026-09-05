import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import type { StorageDriverKind } from '../storage/driver-registry.js';
import { createDidStorageDriver, type DidStorageDriver } from './drivers/did.drivers.js';

export interface DIDRecord {
  id: string;
  subjectType: string;
  controller: string;
  publicKey: string;
  publicKeyMultibase: string | null;
  hederaTopicId: string | null;
  hederaSequenceNumber: number | null;
  hederaTransactionId: string;
  didDocument: unknown;
  deactivatedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateDIDRecordParams {
  id: string;
  subjectType: string;
  controller: string;
  publicKey: string;
  publicKeyMultibase?: string | undefined;
  hederaTransactionId: string;
  hederaTopicId?: string | undefined;
  hederaSequenceNumber?: number | undefined;
  didDocument: unknown;
}

interface DIDUpdateParams {
  updateType: string;
  hederaTransactionId: string;
  payload: unknown;
}

/**
 * DidRepository is now a thin delegator over a DidStorageDriver — see
 * storage/driver-registry.ts for the pattern this follows and
 * repositories/drivers/did.drivers.ts for the postgres/sqlite/in-memory
 * driver implementations. There is no per-backend branching left in this
 * class; it all lives in createDidStorageDriver() and the driver classes
 * themselves.
 *
 * The (prisma?, sqlite?) constructor signature is unchanged on purpose —
 * it's relied on across the existing test suite (unit, integration,
 * security) and server.ts. Backend selection is inferred from which
 * argument is present, exactly as it was before this refactor: prisma
 * present -> postgres, sqlite present (and no prisma) -> sqlite, neither
 * -> in-memory. Adding a backend that can't be inferred this way (e.g. a
 * hypothetical future case where more than one non-prisma backend needs to
 * coexist) would mean adding one more optional constructor parameter and
 * one more branch in resolveDriverKind() — additive and backward
 * compatible, not a rewrite.
 */
export class DidRepository {
  private readonly driver: DidStorageDriver;

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {
    this.driver = createDidStorageDriver(this.resolveDriverKind(), { prisma, sqlite });
  }

  private resolveDriverKind(): StorageDriverKind {
    if (this.prisma) return 'postgres';
    if (this.sqlite) return 'sqlite';
    return 'memory';
  }

  async createDid(data: CreateDIDRecordParams): Promise<DIDRecord> {
    return this.driver.createDid(data);
  }

  async findDidById(id: string): Promise<DIDRecord | null> {
    return this.driver.findDidById(id);
  }

  async findDidByPublicKey(publicKey: string): Promise<DIDRecord | null> {
    return this.driver.findDidByPublicKey(publicKey);
  }

  async updateDidDocument(
    id: string,
    didDocument: unknown,
    update: DIDUpdateParams,
  ): Promise<unknown> {
    return this.driver.updateDidDocument(id, didDocument, update);
  }

  async deactivateDid(id: string, deactivatedAt: Date): Promise<DIDRecord> {
    return this.driver.deactivateDid(id, deactivatedAt);
  }

  // Back-compat aliases for older B3/B4 scaffolding.
  async create(data: CreateDIDRecordParams): Promise<DIDRecord> {
    return this.createDid(data);
  }

  async findByDid(did: string): Promise<DIDRecord | null> {
    return this.findDidById(did);
  }

  async findByPublicKeyMultibase(publicKeyMultibase: string): Promise<DIDRecord | null> {
    return this.driver.findByPublicKeyMultibase(publicKeyMultibase);
  }
}

export { DidRepository as DIDRepository };

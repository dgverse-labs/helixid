import type { PrismaClient } from '@prisma/client';
import { prisma as sharedPrisma } from '../prisma.js';

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

type PrismaLike = PrismaClient & {
  did: {
    create(args: unknown): Promise<DIDRecord>;
    findUnique(args: unknown): Promise<DIDRecord | null>;
    findFirst(args: unknown): Promise<DIDRecord | null>;
    update(args: unknown): Promise<DIDRecord>;
  };
  didUpdate: {
    create(args: unknown): Promise<unknown>;
  };
  $transaction(args: unknown): Promise<unknown>;
};

export class DidRepository {
  constructor(private readonly prisma: PrismaClient = sharedPrisma) {}

  private get db(): PrismaLike {
    return this.prisma as PrismaLike;
  }

  async createDid(data: CreateDIDRecordParams): Promise<DIDRecord> {
    return this.db.did.create({
      data: {
        ...data,
        publicKeyMultibase: data.publicKeyMultibase ?? null,
      },
    });
  }

  async findDidById(id: string): Promise<DIDRecord | null> {
    return this.db.did.findUnique({
      where: { id },
      include: { updates: true },
    });
  }

  async findDidByPublicKey(publicKey: string): Promise<DIDRecord | null> {
    return this.db.did.findFirst({
      where: { publicKey },
    });
  }

  async updateDidDocument(id: string, didDocument: unknown, update: DIDUpdateParams): Promise<unknown> {
    return this.db.$transaction([
      this.db.did.update({
        where: { id },
        data: { didDocument },
      }),
      this.db.didUpdate.create({
        data: {
          ...update,
          did: { connect: { id } },
        },
      }),
    ]);
  }

  async deactivateDid(id: string, deactivatedAt: Date): Promise<DIDRecord> {
    return this.db.did.update({
      where: { id },
      data: { deactivatedAt },
    });
  }

  // Back-compat aliases for older B3/B4 scaffolding.
  async create(data: CreateDIDRecordParams): Promise<DIDRecord> {
    return this.createDid(data);
  }

  async findByDid(did: string): Promise<DIDRecord | null> {
    return this.findDidById(did);
  }

  async findByPublicKeyMultibase(publicKeyMultibase: string): Promise<DIDRecord | null> {
    return this.db.did.findFirst({ where: { publicKeyMultibase } });
  }
}

export { sharedPrisma as prisma };
export { DidRepository as DIDRepository };

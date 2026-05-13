import type { PrismaClient } from '@prisma/client';
import { prisma as sharedPrisma } from '../prisma.js';

type PrismaLike = PrismaClient & {
  did: {
    create(args: any): Promise<any>;
    findUnique(args: any): Promise<any | null>;
    findFirst(args: any): Promise<any | null>;
    update(args: any): Promise<any>;
  };
  didUpdate: {
    create(args: any): Promise<any>;
  };
  $transaction(args: any): Promise<any>;
};

export class DidRepository {
  constructor(private readonly prisma: PrismaClient = sharedPrisma) {}

  private get db(): PrismaLike {
    return this.prisma as PrismaLike;
  }

  async createDid(data: any) {
    return this.db.did.create({ data });
  }

  async findDidById(id: string) {
    return this.db.did.findUnique({
      where: { id },
      include: { updates: true },
    });
  }

  async findDidByPublicKey(publicKey: string) {
    return this.db.did.findFirst({
      where: { publicKey },
    });
  }

  async updateDidDocument(id: string, didDocument: any, update: any) {
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

  async deactivateDid(id: string, deactivatedAt: Date) {
    return this.db.did.update({
      where: { id },
      data: { deactivatedAt },
    });
  }

  // Back-compat aliases for older B3/B4 scaffolding.
  async create(data: any) {
    return this.createDid(data);
  }

  async findByDid(did: string) {
    return this.findDidById(did);
  }

  async findByPublicKeyMultibase(publicKeyMultibase: string) {
    return this.db.did.findFirst({ where: { publicKeyMultibase } });
  }
}

export { sharedPrisma as prisma };
export { DidRepository as DIDRepository };

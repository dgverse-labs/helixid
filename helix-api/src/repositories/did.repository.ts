// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Repository for DID-related database operations.
 * Implements DB-1, DB-2, and DB-4.
 */
export class DidRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Persist a new DID record.
   */
  async createDid(data: Prisma.DidCreateInput) {
    return this.prisma.did.create({ data });
  }

  /**
   * Find a DID by its ID (the did:helix string).
   */
  async findDidById(id: string) {
    return this.prisma.did.findUnique({
      where: { id },
      include: { updates: true },
    });
  }

  /**
   * Find a DID by its public key.
   * Used for deduplication (SA-2).
   */
  async findDidByPublicKey(publicKey: string) {
    return this.prisma.did.findFirst({
      where: { publicKey },
    });
  }

  /**
   * Update a DID document and record the update history in a single transaction.
   */
  async updateDidDocument(
    id: string,
    didDocument: any,
    update: Prisma.DidUpdateCreateWithoutDidInput,
  ) {
    return this.prisma.$transaction([
      this.prisma.did.update({
        where: { id },
        data: { didDocument },
      }),
      this.prisma.didUpdate.create({
        data: {
          ...update,
          did: { connect: { id } },
        },
      }),
    ]);
  }

  /**
   * Mark a DID as deactivated.
   */
  async deactivateDid(id: string, deactivatedAt: Date) {
    return this.prisma.did.update({
      where: { id },
      data: { deactivatedAt },
    });
  }
}

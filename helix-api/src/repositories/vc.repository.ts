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

import { PrismaClient, Vc, StatusListEntry } from '@prisma/client';

export interface CreateVcParams {
  vcId: string;
  subjectDid: string;
  subjectType: string;
  vcJson: any;
  privilegeScopes?: string[] | undefined;
  statusListIndex: number;
  expiresAt: Date;
}

/**
 * Data access layer for Verifiable Credentials and Status Lists.
 */
export class VcRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createVc(params: CreateVcParams): Promise<Vc> {
    return this.prisma.vc.create({
      data: {
        vcId: params.vcId,
        subjectDid: params.subjectDid,
        subjectType: params.subjectType,
        vcJson: params.vcJson,
        privilegeScopes: params.privilegeScopes,
        statusListIndex: params.statusListIndex,
        expiresAt: params.expiresAt,
      },
    });
  }

  async findByVcId(vcId: string): Promise<Vc | null> {
    return this.prisma.vc.findUnique({
      where: { vcId },
    });
  }

  async findStatusListById(listId: string): Promise<StatusListEntry | null> {
    return this.prisma.status_list_entries.findUnique({
      where: { listId },
    });
  }

  async createStatusList(listId: string, encodedList: string): Promise<StatusListEntry> {
    return this.prisma.status_list_entries.create({
      data: {
        listId,
        encodedList,
        nextIndex: 0,
      },
    });
  }

  /**
   * Atomically claims the next index from a status list.
   * Ensures no two issuances get the same index.
   */
  async claimNextIndex(listId: string): Promise<{ list: StatusListEntry; claimedIndex: number }> {
    const list = await this.prisma.status_list_entries.update({
      where: { listId },
      data: {
        nextIndex: { increment: 1 },
      },
    });
    return { list, claimedIndex: list.nextIndex - 1 };
  }

  /**
   * Transactionally updates the status list bitstring and marks a VC as revoked.
   */
  async revokeVc(vcId: string, listId: string, newEncodedList: string): Promise<Vc> {
    return this.prisma.$transaction(async (tx) => {
      await tx.status_list_entries.update({
        where: { listId },
        data: { encodedList: newEncodedList },
      });

      return tx.vc.update({
        where: { vcId },
        data: { revokedAt: new Date() },
      });
    });
  }

  /**
   * Updates an existing VC record when it is renewed.
   */
  async markAsRenewed(oldVcId: string, newVcId: string): Promise<Vc> {
    return this.prisma.vc.update({
      where: { vcId: oldVcId },
      data: { renewedByVcId: newVcId },
    });
  }
}

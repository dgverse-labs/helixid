// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// See docs/proposal-sdk-api-only.md ("prepare-endpoint auth and idempotency").
// A PreparedPayload row is a short-lived, single-use binding between an
// unsigned VC payload the API constructed and the DID that must sign it.
// finalize() consumes it exactly once.

import type { PrismaClient } from '@prisma/client';
import type { SqliteStore } from '../storage/sqlite.js';
import type { StorageDriverKind } from '../storage/driver-registry.js';
import {
  createPreparedPayloadStorageDriver,
  type PreparedPayloadStorageDriver,
} from './drivers/prepared-payload.drivers.js';

export type PreparedPayloadPurpose = 'delegation' | 'grant' | 'agent-renewal';

export interface PreparedPayloadRecord {
  id: string;
  token: string;
  purpose: PreparedPayloadPurpose;
  unsignedPayload: string;
  canonicalHash: string;
  expectedSignerDid: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

/**
 * PreparedPayloadRepository is a thin delegator over a
 * PreparedPayloadStorageDriver — see storage/driver-registry.ts for the
 * pattern and repositories/drivers/did.drivers.ts for the reference
 * implementation. The (prisma?, sqlite?) constructor signature is
 * unchanged on purpose — see did.repository.ts's class doc comment for
 * the full rationale.
 */
export class PreparedPayloadRepository {
  private readonly driver: PreparedPayloadStorageDriver;

  constructor(
    private readonly prisma?: PrismaClient,
    private readonly sqlite?: SqliteStore,
  ) {
    this.driver = createPreparedPayloadStorageDriver(this.resolveDriverKind(), { prisma, sqlite });
  }

  private resolveDriverKind(): StorageDriverKind {
    if (this.prisma) return 'postgres';
    if (this.sqlite) return 'sqlite';
    return 'memory';
  }

  async create(
    data: Omit<PreparedPayloadRecord, 'id' | 'token' | 'consumedAt' | 'createdAt'>,
  ): Promise<PreparedPayloadRecord> {
    return this.driver.create(data);
  }

  async findByToken(token: string): Promise<PreparedPayloadRecord | null> {
    return this.driver.findByToken(token);
  }

  /**
   * Marks a row consumed exactly once — atomic where the backend supports it
   * (single UPDATE ... WHERE consumedAt IS NULL). Returns true only for the
   * caller that actually performed the transition, so concurrent finalize
   * attempts against the same token can't both succeed.
   */
  async markConsumedAtomically(token: string): Promise<boolean> {
    return this.driver.markConsumedAtomically(token);
  }
}

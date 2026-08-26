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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiAuditLogger } from '../../src/audit/index.js';
import type { PrismaClient } from '@prisma/client';
import type { AuditEvent } from '../../src/core/index.js';

describe('ApiAuditLogger', () => {
  let mockPrisma: any;
  let logger: ApiAuditLogger;

  beforeEach(() => {
    mockPrisma = {
      auditLog: {
        create: vi.fn().mockResolvedValue({ id: 'uuid' }),
      },
    };
    logger = new ApiAuditLogger(mockPrisma as unknown as PrismaClient);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('persists audit events to the database', async () => {
    const event: AuditEvent = {
      timestamp: new Date().toISOString(),
      event: 'DID_CREATED',
      requestId: 'req-1',
      did: 'did:helix:abc',
      subjectType: 'agent',
      hederaTransactionId: '0.0.123@123',
      publicKeyMultibase: 'z123',
    };

    await logger.log(event);

    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'DID_CREATED',
        requestId: 'req-1',
        payloadJson: JSON.stringify(event),
      }),
    });
  });

  it('outputs to stdout when configured', async () => {
    // Note: Config is already loaded in core, but we can verify console.log was called
    const event: any = { timestamp: new Date().toISOString(), event: 'TEST', requestId: '1' };
    await logger.log(event);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(event));
  });

  it('swallows database errors to prevent blocking', async () => {
    mockPrisma.auditLog.create.mockRejectedValue(new Error('DB_DOWN'));
    const event: any = { timestamp: new Date().toISOString(), event: 'TEST', requestId: '1' };
    
    await expect(logger.log(event)).resolves.not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});

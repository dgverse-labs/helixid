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

import { PrismaClient } from '@prisma/client';
import { IAuditLogger, AuditEvent, config } from '@helix-id/core';

/**
 * Audit logger for the API.
 * Performs dual-logging:
 * 1. Persistent storage in PostgreSQL (audit_log table).
 * 2. Structured JSON output to stdout for external log aggregators.
 */
export class ApiAuditLogger implements IAuditLogger {
  constructor(private prisma: PrismaClient) {}

  async log(event: AuditEvent): Promise<void> {
    const payloadJson = JSON.stringify(event);

    // 1. Log to stdout (if enabled)
    if (config.AUDIT_LOG_DESTINATION === 'stdout' || config.AUDIT_LOG_DESTINATION === 'both') {
      console.log(payloadJson);
    }

    // 2. Persist to Database
    try {
      await this.prisma.auditLog.create({
        data: {
          timestamp: new Date(event.timestamp),
          eventType: event.event,
          requestId: event.requestId,
          payloadJson,
        },
      });
    } catch (error) {
      // We log but don't throw to prevent audit failures from blocking business operations,
      // although in a strict environment (AL-5), this might be a critical error.
      console.error('FAILED_TO_WRITE_AUDIT_LOG', error);
    }
  }
}
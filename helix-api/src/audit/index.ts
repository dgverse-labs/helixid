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

import { mkdirSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { IAuditLogger, AuditEvent, AuditEventType, type Config } from '@helixid/core';
import type { SqliteStore } from '../storage/sqlite.js';
import { sqliteLiteral } from '../storage/sqlite.js';

type AuditConfig = Pick<Config, 'AUDIT_LOG_DESTINATION' | 'AUDIT_LOG_PATH'>;

/**
 * Audit logger for the API.
 * Performs dual-logging:
 * 1. Persistent storage in PostgreSQL (audit_log table) when DB is enabled.
 * 2. Structured JSON output to stdout and/or append-only file.
 */
export class ApiAuditLogger implements IAuditLogger {
  constructor(
    private readonly prisma: PrismaClient | undefined,
    private readonly config: AuditConfig = {
      AUDIT_LOG_DESTINATION: 'stdout',
      AUDIT_LOG_PATH: undefined,
    },
    private readonly sqlite?: SqliteStore,
  ) {}

  async log(
    eventOrType: AuditEvent | AuditEventType,
    payload?: Record<string, unknown> & { requestId: string; timestamp?: string },
  ): Promise<void> {
    const event: AuditEvent =
      typeof eventOrType === 'string'
        ? ({
            ...(payload ?? { requestId: 'unknown' }),
            event: eventOrType,
            timestamp: payload?.timestamp ?? new Date().toISOString(),
          } as AuditEvent)
        : eventOrType;
    const payloadJson = JSON.stringify(event);

    if (
      this.config.AUDIT_LOG_DESTINATION === 'stdout' ||
      this.config.AUDIT_LOG_DESTINATION === 'both'
    ) {
      console.log(payloadJson);
    }

    if (
      this.config.AUDIT_LOG_DESTINATION === 'file' ||
      this.config.AUDIT_LOG_DESTINATION === 'both'
    ) {
      const path = this.config.AUDIT_LOG_PATH ?? './data/audit.log';
      try {
        mkdirSync(dirname(path), { recursive: true });
        await appendFile(path, `${payloadJson}\n`, 'utf8');
      } catch (error) {
        console.error('FAILED_TO_WRITE_AUDIT_LOG_FILE', error);
      }
    }

    if (this.sqlite) {
      try {
        this.sqlite.execute(`
          INSERT INTO audit_log (timestamp, event_type, request_id, payload_json)
          VALUES (
            ${sqliteLiteral(event.timestamp)},
            ${sqliteLiteral(event.event)},
            ${sqliteLiteral(event.requestId)},
            ${sqliteLiteral(payloadJson)}
          )
        `);
      } catch (error) {
        console.error('FAILED_TO_WRITE_AUDIT_LOG_SQLITE', error);
      }
    }

    if (!this.prisma) return;

    try {
      await this.prisma.auditLog.create({
        data: {
          timestamp: event.timestamp,
          eventType: event.event,
          requestId: event.requestId,
          payloadJson,
        },
      });
    } catch (error) {
      console.error('FAILED_TO_WRITE_AUDIT_LOG_DB', error);
    }
  }
}

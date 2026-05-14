/**
 * helix-api/src/audit/index.ts
 *
 * Audit Log implementation for the API layer.
 * Persists events to the audit_log table and optionally stdout/file.
 */

import { promises as fs } from 'node:fs';
import { type IAuditLogger, type AuditEvent, config } from '@helix-id/core';
import type { PrismaClient } from '@prisma/client';

export class ApiAuditLogger implements IAuditLogger {
  constructor(private readonly prisma: PrismaClient) {}

  log(event: AuditEvent, payload: Record<string, unknown> & { requestId: string; timestamp?: string }): void {
    const timestamp = payload.timestamp || new Date().toISOString();
    const { requestId, timestamp: _ts, ...eventSpecificPayload } = payload;
    
    const payloadJson = JSON.stringify(eventSpecificPayload);
    const logEntry = JSON.stringify({ timestamp, event, requestId, ...eventSpecificPayload });

    // 1. Persist to DB (fire-and-forget to not block the response)
    this.prisma.auditLog.create({
      data: {
        timestamp,
        eventType: event,
        requestId,
        payloadJson,
      },
    }).catch(err => {
      console.error(`[ApiAuditLogger] DB persistence failed for event ${event}:`, err);
    });

    // 2. Stdout
    if (config.AUDIT_LOG_DESTINATION === 'stdout' || config.AUDIT_LOG_DESTINATION === 'both') {
      process.stdout.write(logEntry + '\n');
    }

    // 3. File
    if (
      (config.AUDIT_LOG_DESTINATION === 'file' || config.AUDIT_LOG_DESTINATION === 'both') &&
      config.AUDIT_LOG_PATH
    ) {
      fs.appendFile(config.AUDIT_LOG_PATH, logEntry + '\n').catch(err => {
        console.error(`[ApiAuditLogger] File write failed:`, err);
      });
    }
  }
}

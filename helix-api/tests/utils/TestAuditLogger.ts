import type { AuditEvent, AuditEventType, IAuditLogger } from '@helix-id/core';

export class TestAuditLogger implements IAuditLogger {
  public readonly events: Array<{ event: AuditEvent; payload: Record<string, unknown> }> = [];

  log(event: AuditEvent): void;
  log(event: AuditEventType, payload: Record<string, unknown> & { requestId: string; timestamp?: string }): void;
  log(
    event: AuditEvent | AuditEventType,
    payload?: Record<string, unknown> & { requestId: string; timestamp?: string },
  ): void {
    if (typeof event === 'string') {
      this.events.push({
        event: {
          event,
          timestamp: payload?.timestamp ?? new Date().toISOString(),
          requestId: payload?.requestId ?? 'test-request',
          ...payload,
        },
        payload: payload ?? {},
      });
      return;
    }
    this.events.push({ event, payload: event });
  }
}

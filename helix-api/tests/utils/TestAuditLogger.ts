import type { AuditEvent, IAuditLogger } from '@helix-id/core';

export class TestAuditLogger implements IAuditLogger {
  public readonly events: Array<{ event: AuditEvent; payload: Record<string, unknown> }> = [];

  log(event: AuditEvent, payload: Record<string, unknown>): void {
    this.events.push({ event, payload });
  }
}

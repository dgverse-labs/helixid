import { type AuditEvent, type AuditEventType, AuditEvents } from './events.js';

export { type AuditEvent, type AuditEventType, AuditEvents };

export interface IAuditLogger {
  log(event: AuditEvent): void | Promise<void>;
  log(event: AuditEventType, payload: Record<string, unknown> & { requestId: string; timestamp?: string }): void | Promise<void>;
}

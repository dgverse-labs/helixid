import { type AuditEvent, AuditEvents } from './events.js';

export { type AuditEvent, AuditEvents };

export interface IAuditLogger {
  log(
    event: AuditEvent,
    payload: Record<string, unknown> & {
      requestId: string;
      timestamp?: string;
    }
  ): void;
}

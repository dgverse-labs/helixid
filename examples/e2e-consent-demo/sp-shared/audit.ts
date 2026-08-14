// Service-Provider-side audit emission.
//
// The SP is the only party that knows several facts the activity trail needs:
// whether a presentation actually verified, why it did not, and whether the
// scope a tool requires was present in the grant. Recording those from the
// agent would mean trusting the agent's account of its own authorization —
// so the SP reports them itself, from the process that made the decision.
//
// Every emission is best-effort. An SP must keep serving tool calls when the
// audit sink is unreachable: a booking is not less valid because a log write
// failed, and the failure must never surface to the caller.

import type { AuditEventType } from '@helixid/core';

/**
 * The shared activity-trail envelope. Field names are fixed even though almost
 * everything is optional — that is what lets issuance, presentation,
 * verification, authorization and invocation be queried as one trail later.
 */
export interface ActivityEvent {
  event: AuditEventType;
  timestamp?: string;
  correlationId?: string | undefined;
  agentDid?: string | undefined;
  userDid?: string | undefined;
  vcId?: string | undefined;
  credentialType?: string | undefined;
  issuer?: string | undefined;
  scopes?: string[] | undefined;
  validUntil?: string | undefined;
  credentialStatus?: string | undefined;
  serviceDid?: string | undefined;
  serviceName?: string | undefined;
  toolName?: string | undefined;
  requiredScope?: string | undefined;
  effectiveScopes?: string[] | undefined;
  vpId?: string | undefined;
  result?: 'success' | 'failure' | 'blocked' | undefined;
  reason?: string | undefined;
  resultSummary?: string | undefined;
}

export interface AuditEmitter {
  emit(event: ActivityEvent): void;
}

export interface AuditEmitterOptions {
  helixApiUrl?: string | undefined;
  adminApiKey?: string | undefined;
  serviceDid: string;
  serviceName: string;
  /** Called with a one-line description of anything that could not be sent. */
  onError?: (message: string) => void;
}

/** No-op emitter, used when the SP has no audit sink configured. */
const NOOP: AuditEmitter = { emit: () => undefined };

export function createAuditEmitter(options: AuditEmitterOptions): AuditEmitter {
  const { helixApiUrl, adminApiKey, serviceDid, serviceName } = options;
  if (!helixApiUrl || !adminApiKey) return NOOP;

  const endpoint = `${helixApiUrl.replace(/\/$/, '')}/v1/audit-log/events`;

  return {
    emit(event: ActivityEvent): void {
      // Deliberately not awaited: the tool call's latency and its success must
      // not depend on the audit sink. Errors are swallowed after logging.
      void fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-admin-api-key': adminApiKey },
        body: JSON.stringify({
          serviceDid,
          serviceName,
          source: 'sp',
          timestamp: new Date().toISOString(),
          ...event,
        }),
      })
        .then(async (response) => {
          if (!response.ok) {
            options.onError?.(`audit ${event.event} rejected: HTTP ${response.status}`);
          }
        })
        .catch((error: unknown) => {
          options.onError?.(`audit ${event.event} failed: ${(error as Error).message}`);
        });
    },
  };
}

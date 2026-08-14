// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AuditLogEntry } from '../api/types';

/**
 * Activity-trail fields the API adds for agent-action events. Declared locally
 * rather than widening AuditLogEntry, so the audit view can read them without
 * depending on the SDK's exported shape.
 */
interface ActivityFields {
  correlationId?: string;
  credentialType?: string;
  issuer?: string;
  userDid?: string;
  scopes?: string[];
  durability?: string;
  serviceName?: string;
  serviceDid?: string;
  toolName?: string;
  requiredScope?: string;
  effectiveScopes?: string[];
  reason?: string;
  resultSummary?: string;
  validUntil?: string;
  credentialStatus?: string;
}

type AuditRow = AuditLogEntry & ActivityFields;

type Tone = 'success' | 'danger' | 'blocked' | 'accent' | 'neutral';

/**
 * How each event type reads in the trail. Unlisted types still render — they
 * fall back to their raw name rather than being hidden, because a trail that
 * silently drops events is not a source of truth.
 */
const LABELS: Record<string, { title: string; tone: Tone }> = {
  DID_CREATED: { title: 'DID Created', tone: 'accent' },
  DID_RESOLVED: { title: 'DID Resolved', tone: 'neutral' },
  DID_DEACTIVATED: { title: 'DID Deactivated', tone: 'danger' },
  ENROLLMENT_TOKEN_GENERATED: { title: 'Enrollment Token', tone: 'accent' },
  ENROLLMENT_TOKEN_CONSUMED: { title: 'Enrollment Completed', tone: 'accent' },
  ENROLLMENT_TOKEN_REJECTED: { title: 'Enrollment Rejected', tone: 'danger' },
  AGENT_ONBOARDED: { title: 'Agent Enrolled', tone: 'success' },
  VC_ISSUED: { title: 'Credential Issued', tone: 'success' },
  VC_REVOKED: { title: 'Credential Revoked', tone: 'danger' },
  CONSENT_GRANTED: { title: 'Consent Granted', tone: 'success' },
  CONSENT_REVOKED: { title: 'Consent Revoked', tone: 'danger' },
  VC_PRESENTED: { title: 'Credential Presented', tone: 'accent' },
  VP_VERIFIED: { title: 'Verification Success', tone: 'success' },
  VP_REJECTED: { title: 'Verification FAILED', tone: 'danger' },
  AUTHZ_GRANTED: { title: 'Authorization Granted', tone: 'success' },
  AUTHZ_DENIED: { title: 'Authorization BLOCKED', tone: 'blocked' },
  TOOL_INVOKED: { title: 'Action Performed', tone: 'accent' },
};

/**
 * Refusals that mean "nobody has asked the user yet" rather than "the user
 * said no to this". Both are genuinely AUTHZ_DENIED — the Service Provider did
 * refuse the call — but only the second is a security decision. An agent's
 * first call to a new service is *expected* to be refused this way: that
 * refusal is what raises the consent prompt. Showing it as BLOCKED in the
 * middle of a successful booking reads as a fault when nothing went wrong.
 */
const CONSENT_HANDSHAKE_REASONS = new Set(['NO_PRESENTATION', 'NO_GRANT_FOR_THIS_SERVICE']);

function isConsentHandshake(entry: AuditRow): boolean {
  return entry.eventType === 'AUTHZ_DENIED' && CONSENT_HANDSHAKE_REASONS.has(entry.reason ?? '');
}

/**
 * Tone for an event type the map does not know about. Keeps a new or
 * differently-cased event from silently rendering as 'neutral' just because
 * nobody added it to LABELS yet.
 */
function fallbackTone(eventType: string): Tone {
  const type = eventType.toLowerCase();
  if (/revoked|rejected|failed|denied|blocked/.test(type)) return 'danger';
  if (/complete|verified|onboarded|granted/.test(type)) return 'success';
  if (/issued|created|generated|consumed|presented|invoked/.test(type)) return 'accent';
  return 'neutral';
}

function labelFor(entry: AuditRow): { title: string; tone: Tone } {
  if (isConsentHandshake(entry)) return { title: 'Consent Required', tone: 'neutral' };
  return (
    LABELS[entry.eventType] ?? {
      title: entry.eventType.replaceAll('_', ' '),
      tone: fallbackTone(entry.eventType),
    }
  );
}

/** The recorded outcome overrides the label's default: a failed action is not a success. */
function toneFor(entry: AuditRow): Tone {
  // Checked before `result`, which is 'blocked' for the handshake too — the
  // call really was refused; it just isn't a denial of anything.
  if (isConsentHandshake(entry)) return 'neutral';
  if (entry.result === 'failure') return 'danger';
  if (entry.result === 'blocked') return 'blocked';
  return labelFor(entry).tone;
}

function markFor(entry: AuditRow, tone: Tone): string {
  if (isConsentHandshake(entry)) return '⇢';
  if (tone === 'danger') return '✕';
  if (tone === 'blocked') return '⃠';
  return '✓';
}

/**
 * The structured facts behind an event, in the order an auditor reads them:
 * what was attempted, under what authority, against whom, and by whose grant.
 */
function factsFor(entry: AuditRow): Array<[string, string]> {
  const facts: Array<[string, string]> = [];
  if (entry.toolName) facts.push(['Action', entry.toolName]);
  if (entry.requiredScope) facts.push(['Scope', entry.requiredScope]);
  if (entry.credentialType) facts.push(['Credential', entry.credentialType]);
  if (entry.serviceName) facts.push(['Service', entry.serviceName]);
  else if (entry.targetService) facts.push(['Service', entry.targetService]);
  if (entry.issuer) facts.push(['Issuer', entry.issuer]);
  if (entry.userDid) facts.push(['User', entry.userDid]);
  if (entry.scopes?.length) facts.push(['Granted', entry.scopes.join(', ')]);
  if (entry.durability) facts.push(['Durability', entry.durability]);
  if (entry.effectiveScopes?.length) facts.push(['Effective', entry.effectiveScopes.join(', ')]);
  if (entry.validUntil) facts.push(['Expires', new Date(entry.validUntil).toLocaleString()]);
  if (entry.credentialStatus) facts.push(['Status', entry.credentialStatus]);
  if (entry.delegatedFrom) facts.push(['Delegated from', entry.delegatedFrom]);
  if (entry.vcId) facts.push(['VC', entry.vcId]);
  if (entry.correlationId) facts.push(['Trace', entry.correlationId]);
  return facts;
}

function relativeTime(timestamp: string): string {
  const delta = Date.now() - new Date(timestamp).getTime();
  if (Number.isNaN(delta)) return timestamp;
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function AuditPage() {
  const [entries, setEntries] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getAuditLog({ limit: 100 });
      // The API returns newest-first; the trail reads as a story oldest-first,
      // which is also what makes the step numbering meaningful.
      setEntries([...(result as AuditRow[])].reverse());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  return (
    <div className="audit-page">
      <div className="page-header">
        <div>
          <h1>Audit &amp; Governance</h1>
          <p className="page-subtitle">
            Every credential issued, presented, verified, authorized and used — identity through
            to result.
          </p>
        </div>
        <div className="audit-header-actions">
          {entries.length > 0 && (
            <span className="audit-count">
              {entries.length} event{entries.length === 1 ? '' : 's'}
            </span>
          )}
          <button type="button" onClick={() => void loadAudit()}>
            Refresh
          </button>
        </div>
      </div>

      {loading && <p className="loading-note">Loading audit log…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="empty-state">No audit events yet.</p>
      )}
      {!loading && !error && entries.length > 0 && (
        <div className="card audit-card">
          <ul className="audit-timeline">
            {entries.map((entry, index) => {
              const tone = toneFor(entry);
              const { title } = labelFor(entry);
              const detail = entry.resultSummary ?? entry.reason;
              const facts = factsFor(entry);
              return (
                <li key={entry.id} className={`audit-entry tone-${tone}`}>
                  <div className="audit-entry-top">
                    <span className="audit-event-type">
                      <span className="audit-mark">{markFor(entry, tone)}</span>
                      {index + 1}. {title}
                    </span>
                    <time
                      dateTime={entry.timestamp}
                      title={new Date(entry.timestamp).toLocaleString()}
                    >
                      {relativeTime(entry.timestamp)}
                    </time>
                  </div>

                  {detail && <div className="audit-summary">{detail}</div>}

                  {/* Kept distinct from the summary: the reason is the machine-readable
                      code an operator greps for, the summary is the sentence. */}
                  {entry.reason && entry.reason !== detail && (
                    <div className="audit-reason">{entry.reason}</div>
                  )}

                  {facts.length > 0 && (
                    <dl className="audit-facts">
                      {facts.map(([key, value]) => (
                        <div className="audit-fact" key={`${entry.id}-${key}`}>
                          <dt>{key}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {entry.subjectDid && (
                    <div className="audit-subject">
                      <Link to={`/agents?subjectDid=${encodeURIComponent(entry.subjectDid)}`}>
                        {entry.subjectDid}
                      </Link>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

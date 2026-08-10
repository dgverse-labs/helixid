// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AuditLogEntry } from '../api/types';

function describe(entry: AuditLogEntry): string {
  const parts: string[] = [];
  if (entry.subjectDid) parts.push(entry.subjectDid);
  if (entry.vcId) parts.push(entry.vcId);
  if (entry.targetService) parts.push(`service ${entry.targetService}`);
  if (entry.result) parts.push(entry.result);
  return parts.join(' · ');
}

/**
 * Color tone for the timeline dot + event label. Event types arrive upper-cased
 * (`VP_VERIFIED`), so match case-insensitively — testing the raw value against
 * lower-case patterns silently made every event 'neutral'.
 */
function tone(eventType: string): 'success' | 'danger' | 'accent' | 'neutral' {
  const type = eventType.toLowerCase();
  if (/revoked|rejected|failed/.test(type)) return 'danger';
  if (/complete|verified|onboarded|granted/.test(type)) return 'success';
  if (/issued|created|generated|consumed/.test(type)) return 'accent';
  return 'neutral';
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
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getAuditLog({ limit: 20 });
      setEntries(result);
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
            Tamper-evident record of identity, credential and verification events.
          </p>
        </div>
        <button type="button" onClick={() => void loadAudit()}>
          Refresh
        </button>
      </div>

      {loading && <p className="loading-note">Loading audit log…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="empty-state">No audit events yet.</p>
      )}
      {!loading && !error && entries.length > 0 && (
        <div className="card audit-card">
          <ul className="audit-timeline">
            {entries.map((entry) => (
              <li key={entry.id} className={`audit-entry tone-${tone(entry.eventType)}`}>
                <div className="audit-entry-top">
                  <span className="audit-event-type">{entry.eventType.replaceAll('_', ' ')}</span>{' '}
                  <time
                    dateTime={entry.timestamp}
                    title={new Date(entry.timestamp).toLocaleString()}
                  >
                    {relativeTime(entry.timestamp)}
                  </time>
                </div>
                <div className="audit-description">
                  {entry.subjectDid ? (
                    <Link to={`/agents?subjectDid=${encodeURIComponent(entry.subjectDid)}`}>
                      {describe(entry)}
                    </Link>
                  ) : (
                    describe(entry)
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

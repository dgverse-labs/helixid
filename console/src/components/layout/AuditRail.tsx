// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import type { AuditLogEntry } from '../../api/types';
import { useAuditRefresh } from '../../hooks/useAuditRefresh';

function describe(entry: AuditLogEntry): string {
  const parts: string[] = [];
  if (entry.subjectDid) parts.push(entry.subjectDid);
  if (entry.vcId) parts.push(entry.vcId);
  if (entry.targetService) parts.push(`service ${entry.targetService}`);
  if (entry.result) parts.push(entry.result);
  return parts.join(' · ');
}

/** Color tone for the timeline dot + event label. */
function tone(eventType: string): 'success' | 'danger' | 'accent' | 'neutral' {
  if (/revoked|rejected|failed/.test(eventType)) return 'danger';
  if (/complete|verified|onboarded/.test(eventType)) return 'success';
  if (/issued|created|generated|consumed/.test(eventType)) return 'accent';
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

export function AuditRail() {
  const { refreshKey } = useAuditRefresh();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getAuditLog({ limit: 20 })
      .then((result) => {
        if (cancelled) return;
        setEntries(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load audit log');
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return (
    <aside className="audit-rail card" aria-label="Audit log">
      <h2>Audit log</h2>
      {error && <p role="alert">{error}</p>}
      {!error && entries.length === 0 && <p className="audit-empty">No audit events yet.</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id} className={`audit-entry tone-${tone(entry.eventType)}`}>
            <div className="audit-entry-top">
              <span className="audit-event-type">{entry.eventType}</span>{' '}
              <time dateTime={entry.timestamp} title={new Date(entry.timestamp).toLocaleString()}>
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
    </aside>
  );
}

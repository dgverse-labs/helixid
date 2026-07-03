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
    <aside className="audit-rail" aria-label="Audit log">
      <h2>Audit log</h2>
      {error && <p role="alert">{error}</p>}
      {!error && entries.length === 0 && <p>No audit events yet.</p>}
      <ul>
        {entries.map((entry) => (
          <li key={entry.id} className="audit-entry">
            <span className="audit-event-type">{entry.eventType}</span>{' '}
            <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
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

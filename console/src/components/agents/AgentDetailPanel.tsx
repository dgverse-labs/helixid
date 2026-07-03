// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import type { VCResponse, VCSummary } from '../../api/types';
import { RevokeButton } from './RevokeButton';

export interface AgentDetailPanelProps {
  summary: VCSummary;
  detail: VCResponse | null;
  /** Prior/renewed VCs for the same DID (dev spec §5.1 credential history). */
  history: VCSummary[];
  onRevoke: () => Promise<void>;
  onClose: () => void;
}

export function AgentDetailPanel({
  summary,
  detail,
  history,
  onRevoke,
  onClose,
}: AgentDetailPanelProps) {
  const status = (detail?.status as string | undefined) ?? summary.status;
  const otherVCs = history.filter((vc) => vc.vcId !== summary.vcId);

  return (
    <section className="agent-detail" aria-label={`Agent ${summary.agentName ?? summary.vcId}`}>
      <header className="agent-detail-header">
        <h2>{summary.agentName ?? summary.subjectDid}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      <dl>
        <dt>DID</dt>
        <dd>{summary.subjectDid}</dd>
        <dt>VC ID</dt>
        <dd>{summary.vcId}</dd>
        <dt>Status</dt>
        <dd>
          <span className={`status-badge status-${status}`}>{status}</span>
        </dd>
        <dt>Scopes</dt>
        <dd>
          {summary.scopes.map((scope) => (
            <span key={scope} className="scope-chip">
              {scope}
            </span>
          ))}
        </dd>
        <dt>Issued</dt>
        <dd>{summary.issuedAt}</dd>
        <dt>Expires</dt>
        <dd>{summary.expiresAt}</dd>
        {summary.parentVcId && (
          <>
            <dt>Delegated from</dt>
            <dd>{summary.parentVcId}</dd>
          </>
        )}
      </dl>

      <RevokeButton onRevoke={onRevoke} disabled={status !== 'active'} />

      {detail?.vc !== undefined && (
        <details className="vc-json">
          <summary>Full VC JSON</summary>
          <pre>{JSON.stringify(detail.vc, null, 2)}</pre>
        </details>
      )}

      <h3>Credential history</h3>
      {otherVCs.length === 0 ? (
        <p>No prior credentials for this DID.</p>
      ) : (
        <ul>
          {otherVCs.map((vc) => (
            <li key={vc.vcId}>
              {vc.vcId} — <span className={`status-badge status-${vc.status}`}>{vc.status}</span>{' '}
              (issued {vc.issuedAt})
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

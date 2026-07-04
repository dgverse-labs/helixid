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
    <section
      className="agent-detail card"
      aria-label={`Agent ${summary.agentName ?? summary.vcId}`}
    >
      <header className="agent-detail-header">
        <h2>{summary.agentName ?? summary.subjectDid}</h2>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </header>

      <dl>
        <div className="detail-pair">
          <dt>DID</dt>
          <dd>{summary.subjectDid}</dd>
        </div>
        <div className="detail-pair">
          <dt>VC ID</dt>
          <dd>{summary.vcId}</dd>
        </div>
        <div className="detail-pair">
          <dt>Status</dt>
          <dd>
            <span className={`status-badge status-${status}`}>{status}</span>
          </dd>
        </div>
        <div className="detail-pair">
          <dt>Scopes</dt>
          <dd>
            {summary.scopes.map((scope) => (
              <span key={scope} className="scope-chip">
                {scope}
              </span>
            ))}
          </dd>
        </div>
        <div className="detail-pair">
          <dt>Issued</dt>
          <dd>{summary.issuedAt}</dd>
        </div>
        <div className="detail-pair">
          <dt>Expires</dt>
          <dd>{summary.expiresAt}</dd>
        </div>
        {summary.parentVcId && (
          <div className="detail-pair">
            <dt>Delegated from</dt>
            <dd>{summary.parentVcId}</dd>
          </div>
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
        <p className="audit-empty">No prior credentials for this DID.</p>
      ) : (
        <ul className="history-list">
          {otherVCs.map((vc) => (
            <li key={vc.vcId}>
              {vc.vcId} —{' '}
              <span className={`status-badge status-${vc.status}`}>{vc.status}</span>{' '}
              <span className="history-date">issued {vc.issuedAt}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

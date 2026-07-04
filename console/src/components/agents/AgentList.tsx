// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useRef, useState } from 'react';
import type { VCSummary } from '../../api/types';
import { BotIcon } from '../layout/icons';

function truncateDid(did: string): string {
  return did.length <= 24 ? did : `${did.slice(0, 16)}…${did.slice(-6)}`;
}

export interface AgentListProps {
  agents: VCSummary[];
  onSelect: (agent: VCSummary) => void;
  selectedVcId?: string | undefined;
}

export function AgentList({ agents, onSelect, selectedVcId }: AgentListProps) {
  const [copiedDid, setCopiedDid] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  if (agents.length === 0) {
    return <p className="empty-state">No agents found.</p>;
  }

  const copyDid = (did: string) => {
    void navigator.clipboard.writeText(did);
    setCopiedDid(did);
    if (copyTimer.current !== undefined) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedDid(null), 1500);
  };

  return (
    <table className="agent-list">
      <thead>
        <tr>
          <th>Agent</th>
          <th>DID</th>
          <th>Scopes</th>
          <th>Status</th>
          <th>Delegation</th>
        </tr>
      </thead>
      <tbody>
        {agents.map((agent) => (
          <tr
            key={agent.vcId}
            onClick={() => onSelect(agent)}
            className={`agent-row${agent.vcId === selectedVcId ? ' selected' : ''}`}
          >
            <td>
              <span className="agent-name">
                <span className="agent-avatar">
                  <BotIcon />
                </span>
                {agent.agentName ?? '—'}
              </span>
            </td>
            <td>
              <button
                type="button"
                className={`did-copy unstyled${agent.subjectDid === copiedDid ? ' copied' : ''}`}
                title={agent.subjectDid}
                onClick={(event) => {
                  event.stopPropagation();
                  copyDid(agent.subjectDid);
                }}
              >
                {agent.subjectDid === copiedDid ? 'Copied ✓' : truncateDid(agent.subjectDid)}
              </button>
            </td>
            <td>
              {agent.scopes.map((scope) => (
                <span key={scope} className="scope-chip">
                  {scope}
                </span>
              ))}
            </td>
            <td>
              <span className={`status-badge status-${agent.status}`}>{agent.status}</span>
            </td>
            <td>
              {agent.parentVcId ? (
                <span className="delegation-note">delegated from {agent.parentVcId}</span>
              ) : (
                ''
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import type { VCSummary } from '../../api/types';

function truncateDid(did: string): string {
  return did.length <= 24 ? did : `${did.slice(0, 16)}…${did.slice(-6)}`;
}

export interface AgentListProps {
  agents: VCSummary[];
  onSelect: (agent: VCSummary) => void;
}

export function AgentList({ agents, onSelect }: AgentListProps) {
  if (agents.length === 0) {
    return <p>No agents found.</p>;
  }
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
          <tr key={agent.vcId} onClick={() => onSelect(agent)} className="agent-row">
            <td>{agent.agentName ?? '—'}</td>
            <td>
              <button
                type="button"
                className="did-copy"
                title={agent.subjectDid}
                onClick={(event) => {
                  event.stopPropagation();
                  void navigator.clipboard.writeText(agent.subjectDid);
                }}
              >
                {truncateDid(agent.subjectDid)}
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
            <td>{agent.parentVcId ? `delegated from ${agent.parentVcId}` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { VCResponse, VCSummary } from '../api/types';
import { AgentList } from '../components/agents/AgentList';
import { AgentDetailPanel } from '../components/agents/AgentDetailPanel';
import { useAuditRefresh } from '../hooks/useAuditRefresh';

/** One row per DID: the API returns newest first, so keep first occurrence. */
function latestPerDid(vcs: VCSummary[]): VCSummary[] {
  const seen = new Set<string>();
  return vcs.filter((vc) => {
    if (seen.has(vc.subjectDid)) return false;
    seen.add(vc.subjectDid);
    return true;
  });
}

export function AgentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const subjectDidFilter = searchParams.get('subjectDid');
  const { refreshAudit } = useAuditRefresh();

  const [agents, setAgents] = useState<VCSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<VCSummary | null>(null);
  const [detail, setDetail] = useState<VCResponse | null>(null);
  const [history, setHistory] = useState<VCSummary[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listAgents(
        subjectDidFilter ? { subjectDid: subjectDidFilter } : undefined,
      );
      setAgents(latestPerDid(result));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, [subjectDidFilter]);

  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);

  const loadDetail = useCallback(async (agent: VCSummary) => {
    const [detailResult, historyResult] = await Promise.all([
      api.getAgent(agent.vcId),
      api.listAgents({ subjectDid: agent.subjectDid }),
    ]);
    setDetail(detailResult);
    setHistory(historyResult);
  }, []);

  const handleSelect = useCallback(
    (agent: VCSummary) => {
      setSelected(agent);
      setDetail(null);
      setHistory([]);
      void loadDetail(agent).catch((err: unknown) => {
        setToast(err instanceof Error ? err.message : 'Failed to load agent detail');
      });
    },
    [loadDetail],
  );

  // Revocation is confirmed-then-shown: the badge flips only after the API
  // succeeds and the detail is re-fetched (dev spec §5.1).
  const handleRevoke = useCallback(async () => {
    if (!selected) return;
    try {
      await api.revokeAgent(selected.vcId);
      await loadDetail(selected);
      setToast(`Revoked ${selected.vcId}`);
      refreshAudit();
    } catch (err: unknown) {
      setToast(err instanceof Error ? err.message : 'Revocation failed');
    }
  }, [selected, loadDetail, refreshAudit]);

  return (
    <div className="agents-page">
      <div className="page-header">
        <h1>Agents</h1>
        <button type="button" onClick={() => void loadAgents()}>
          Refresh
        </button>
      </div>

      {subjectDidFilter && (
        <p className="filter-note">
          Filtered by DID {subjectDidFilter}{' '}
          <button type="button" onClick={() => setSearchParams({})}>
            Clear filter
          </button>
        </p>
      )}

      {toast && (
        <p role="status" className="toast">
          {toast} <button type="button" onClick={() => setToast(null)}>Dismiss</button>
        </p>
      )}

      {loading && <p>Loading agents…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && <AgentList agents={agents} onSelect={handleSelect} />}

      {selected && (
        <AgentDetailPanel
          summary={history.find((vc) => vc.vcId === selected.vcId) ?? selected}
          detail={detail}
          history={history}
          onRevoke={handleRevoke}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

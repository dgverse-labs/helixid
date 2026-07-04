// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AgentsPage } from '../../src/pages/AgentsPage';
import { api } from '../../src/api/client';
import type { VCSummary } from '../../src/api/types';

vi.mock('../../src/api/client', () => ({
  api: {
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    revokeAgent: vi.fn(),
  },
}));

const listAgents = vi.mocked(api.listAgents);
const getAgent = vi.mocked(api.getAgent);
const revokeAgent = vi.mocked(api.revokeAgent);

const billing: VCSummary = {
  vcId: 'vc:helix:billing',
  subjectDid: 'did:hedera:testnet:billing',
  agentName: 'billing-agent',
  scopes: ['read:orders'],
  status: 'active',
  issuedAt: '2026-06-01T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
};

const delegated: VCSummary = {
  vcId: 'vc:helix:delegated',
  subjectDid: 'did:hedera:testnet:delegated',
  agentName: 'delegated-agent',
  scopes: ['read:orders'],
  status: 'active',
  issuedAt: '2026-06-02T00:00:00.000Z',
  expiresAt: '2026-09-01T00:00:00.000Z',
  parentVcId: 'vc:helix:billing',
};

function renderPage(initialEntry = '/agents') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AgentsPage />
    </MemoryRouter>,
  );
}

describe('AgentsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listAgents.mockResolvedValue([billing, delegated]);
    getAgent.mockResolvedValue({ vcId: billing.vcId, vc: { id: billing.vcId }, status: 'active' });
  });

  it('loads the list, opens the detail panel, and revokes non-optimistically', async () => {
    const revokedSummary: VCSummary = { ...billing, status: 'revoked' };
    listAgents.mockImplementation(async (filters) => {
      if (filters?.subjectDid === billing.subjectDid) {
        return revokeAgent.mock.calls.length > 0 ? [revokedSummary] : [billing];
      }
      return [billing, delegated];
    });
    revokeAgent.mockResolvedValue({
      vcId: billing.vcId,
      revoked: true,
      revokedAt: '2026-07-04T00:00:00.000Z',
    });
    getAgent.mockImplementation(async () => ({
      vcId: billing.vcId,
      vc: { id: billing.vcId },
      status: revokeAgent.mock.calls.length > 0 ? 'revoked' : 'active',
    }));

    renderPage();

    // List loads with one row per agent; delegation lineage is visible.
    const row = await screen.findByText('billing-agent');
    expect(screen.getByText('delegated from vc:helix:billing')).toBeInTheDocument();

    // Open the detail panel.
    await userEvent.click(row);
    const panel = await screen.findByRole('region', { name: /billing-agent/i });
    expect(within(panel).getByText('vc:helix:billing')).toBeInTheDocument();
    expect(getAgent).toHaveBeenCalledWith(billing.vcId);
    expect(listAgents).toHaveBeenCalledWith({ subjectDid: billing.subjectDid });

    // Revoke: badge flips only after the API confirms + re-fetch.
    await userEvent.click(within(panel).getByRole('button', { name: 'Revoke' }));
    expect(revokeAgent).toHaveBeenCalledWith(billing.vcId);
    expect(await within(panel).findByText('revoked')).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent(/revoked vc:helix:billing/i);
  });

  it('shows an error toast and keeps the badge when revocation fails', async () => {
    revokeAgent.mockRejectedValue(new Error('revocation exploded'));
    renderPage();

    await userEvent.click(await screen.findByText('billing-agent'));
    const panel = await screen.findByRole('region', { name: /billing-agent/i });
    await userEvent.click(within(panel).getByRole('button', { name: 'Revoke' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/revocation exploded/i);
    expect(within(panel).getAllByText('active').length).toBeGreaterThan(0);
    expect(within(panel).queryByText('revoked')).not.toBeInTheDocument();
  });

  it('refreshes the list only when Refresh is clicked', async () => {
    renderPage();
    await screen.findByText('billing-agent');
    expect(listAgents).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(listAgents).toHaveBeenCalledTimes(2);
  });

  it('applies the subjectDid filter from the query string', async () => {
    listAgents.mockResolvedValue([billing]);
    renderPage(`/agents?subjectDid=${encodeURIComponent(billing.subjectDid)}`);

    await screen.findByText('billing-agent');
    expect(listAgents).toHaveBeenCalledWith({ subjectDid: billing.subjectDid });
    expect(screen.getByText(/filtered by did/i)).toBeInTheDocument();
  });

  it('clears the subjectDid filter', async () => {
    listAgents.mockResolvedValue([billing]);
    renderPage(`/agents?subjectDid=${encodeURIComponent(billing.subjectDid)}`);
    await screen.findByText(/filtered by did/i);

    await userEvent.click(screen.getByRole('button', { name: /clear filter/i }));
    expect(screen.queryByText(/filtered by did/i)).not.toBeInTheDocument();
    expect(listAgents).toHaveBeenLastCalledWith(undefined);
  });

  it('closes the detail panel and dismisses toasts', async () => {
    revokeAgent.mockRejectedValue(new Error('nope'));
    renderPage();

    await userEvent.click(await screen.findByText('billing-agent'));
    const panel = await screen.findByRole('region', { name: /billing-agent/i });
    await userEvent.click(within(panel).getByRole('button', { name: 'Revoke' }));
    await screen.findByRole('status');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('region', { name: /billing-agent/i })).not.toBeInTheDocument();
  });

  it('toasts when loading the detail fails', async () => {
    getAgent.mockRejectedValue(new Error('detail exploded'));
    renderPage();

    await userEvent.click(await screen.findByText('billing-agent'));
    expect(await screen.findByRole('status')).toHaveTextContent('detail exploded');
  });

  it('shows a delegated agent lineage in the detail panel', async () => {
    getAgent.mockResolvedValue({
      vcId: delegated.vcId,
      vc: { id: delegated.vcId },
      status: 'active',
    });
    listAgents.mockImplementation(async (filters) =>
      filters?.subjectDid === delegated.subjectDid ? [delegated] : [billing, delegated],
    );
    renderPage();

    await userEvent.click(await screen.findByText('delegated-agent'));
    const panel = await screen.findByRole('region', { name: /delegated-agent/i });
    expect(within(panel).getByText('Delegated from')).toBeInTheDocument();
    expect(within(panel).getByText(/no prior credentials/i)).toBeInTheDocument();
  });

  it('surfaces load errors', async () => {
    listAgents.mockRejectedValue(new Error('api unreachable'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('api unreachable');
  });
});

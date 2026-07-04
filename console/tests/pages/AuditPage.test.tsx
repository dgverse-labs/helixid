// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuditPage } from '../../src/pages/AuditPage';
import { api } from '../../src/api/client';

vi.mock('../../src/api/client', () => ({ api: { getAuditLog: vi.fn() } }));
const getAuditLog = vi.mocked(api.getAuditLog);

function renderPage() {
  return render(
    <MemoryRouter>
      <AuditPage />
    </MemoryRouter>,
  );
}

describe('AuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuditLog.mockResolvedValue([
      {
        id: '1',
        eventType: 'vc_revoked',
        timestamp: '2026-06-01T12:00:00.000Z',
        subjectDid: 'did:hedera:testnet:billing',
        vcId: 'vc:helix:billing',
      },
      {
        id: '2',
        eventType: 'onboarding_complete',
        timestamp: '2026-06-01T11:00:00.000Z',
        subjectDid: 'did:hedera:testnet:x',
      },
      { id: '3', eventType: 'jwt_issued', timestamp: '2026-06-01T10:00:00.000Z' },
      {
        id: '4',
        eventType: 'vp_verified',
        timestamp: '2026-06-01T09:00:00.000Z',
        targetService: 'orders-api',
        result: 'success',
      },
    ]);
  });

  it('loads events on mount, deep-links, and tone-codes the timeline', async () => {
    renderPage();

    expect(await screen.findByText('vc_revoked')).toBeInTheDocument();
    expect(getAuditLog).toHaveBeenCalledWith({ limit: 20 });

    // Deep link to the pre-filtered Agents page.
    expect(
      screen.getByRole('link', { name: /did:hedera:testnet:billing/ }),
    ).toHaveAttribute(
      'href',
      `/agents?subjectDid=${encodeURIComponent('did:hedera:testnet:billing')}`,
    );

    // No subjectDid → plain text, no link.
    expect(screen.getByText('jwt_issued')).toBeInTheDocument();
    expect(screen.getByText('service orders-api · success')).toBeInTheDocument();

    // Timeline tone classes.
    expect(screen.getByText('vc_revoked').closest('li')).toHaveClass('tone-danger');
    expect(screen.getByText('onboarding_complete').closest('li')).toHaveClass('tone-success');
    expect(screen.getByText('jwt_issued').closest('li')).toHaveClass('tone-accent');
  });

  it('refetches when Refresh is clicked', async () => {
    renderPage();
    await screen.findByText('vc_revoked');
    expect(getAuditLog).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(getAuditLog).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when there are no events', async () => {
    getAuditLog.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText(/no audit events yet/i)).toBeInTheDocument();
  });

  it('surfaces load errors', async () => {
    getAuditLog.mockRejectedValue(new Error('audit down'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('audit down');
  });
});

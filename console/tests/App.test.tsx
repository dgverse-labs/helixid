// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../src/App';
import { api } from '../src/api/client';

vi.mock('../src/api/client', () => ({
  api: {
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    revokeAgent: vi.fn(),
    listServices: vi.fn(),
    registerService: vi.fn(),
    createEnrollmentToken: vi.fn(),
    getAuditLog: vi.fn(),
  },
}));

const mocked = vi.mocked(api);

function renderApp(initialEntry = '/') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>,
  );
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.listAgents.mockResolvedValue([]);
    mocked.listServices.mockResolvedValue([]);
    mocked.getAuditLog.mockResolvedValue([
      {
        id: '1',
        eventType: 'vc_revoked',
        timestamp: '2026-06-01T12:00:00.000Z',
        subjectDid: 'did:hedera:testnet:billing',
        vcId: 'vc:helix:billing',
      },
      {
        id: '2',
        eventType: 'jwt_issued',
        timestamp: '2026-06-01T11:00:00.000Z',
      },
      {
        id: '3',
        eventType: 'vp_verified',
        timestamp: '2026-06-01T10:00:00.000Z',
        targetService: 'orders-api',
        result: 'success',
      },
    ]);
  });

  it('redirects / to the Agents page and shows the audit rail on every page', async () => {
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();

    // The persistent audit rail is populated from getAuditLog({limit: 20}).
    const rail = screen.getByRole('complementary', { name: /audit log/i });
    expect(mocked.getAuditLog).toHaveBeenCalledWith({ limit: 20 });
    expect(await within(rail).findByText('vc_revoked')).toBeInTheDocument();

    // Entries with a subjectDid deep-link to the pre-filtered Agents page.
    expect(
      within(rail).getByRole('link', { name: /did:hedera:testnet:billing/ }),
    ).toHaveAttribute(
      'href',
      `/agents?subjectDid=${encodeURIComponent('did:hedera:testnet:billing')}`,
    );
    // Entries without a subjectDid render as plain text.
    expect(within(rail).getByText('jwt_issued')).toBeInTheDocument();
    expect(within(rail).getByText('service orders-api · success')).toBeInTheDocument();

    // Navigation keeps the rail visible.
    await userEvent.click(screen.getByRole('link', { name: 'Services' }));
    expect(await screen.findByRole('heading', { name: 'Services' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /audit log/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Enroll' }));
    expect(
      await screen.findByRole('heading', { name: /enroll an agent/i }),
    ).toBeInTheDocument();
  });

  it('shows an audit rail error without breaking the page', async () => {
    mocked.getAuditLog.mockRejectedValue(new Error('audit log unavailable'));
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    const rail = screen.getByRole('complementary', { name: /audit log/i });
    expect(await within(rail).findByRole('alert')).toHaveTextContent('audit log unavailable');
  });
});

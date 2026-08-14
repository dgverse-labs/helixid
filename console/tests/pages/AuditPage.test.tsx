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

/** The entry whose rendered title matches, as the <li> carrying the tone class. */
function entryByTitle(title: string | RegExp): HTMLElement {
  const match = screen
    .getAllByRole('listitem')
    .find((li) => (typeof title === 'string' ? li.textContent?.includes(title) : title.test(li.textContent ?? '')));
  if (!match) throw new Error(`No audit entry matching ${String(title)}`);
  return match;
}

describe('AuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Newest-first, as the API returns them.
    getAuditLog.mockResolvedValue([
      {
        id: '1',
        eventType: 'VC_REVOKED',
        timestamp: '2026-06-01T12:00:00.000Z',
        subjectDid: 'did:hedera:testnet:billing',
        vcId: 'vc:helix:billing',
      },
      {
        id: '2',
        eventType: 'AGENT_ONBOARDED',
        timestamp: '2026-06-01T11:00:00.000Z',
        subjectDid: 'did:hedera:testnet:x',
      },
      { id: '3', eventType: 'jwt_issued', timestamp: '2026-06-01T10:00:00.000Z' },
      {
        id: '4',
        eventType: 'VP_VERIFIED',
        timestamp: '2026-06-01T09:00:00.000Z',
        targetService: 'orders-api',
        result: 'success',
      },
    ] as never);
  });

  it('loads events on mount, deep-links, and tone-codes the timeline', async () => {
    renderPage();

    expect(await screen.findByText(/Credential Revoked/)).toBeInTheDocument();
    expect(getAuditLog).toHaveBeenCalledWith({ limit: 100 });

    // Deep link to the pre-filtered Agents page.
    expect(screen.getByRole('link', { name: /did:hedera:testnet:billing/ })).toHaveAttribute(
      'href',
      `/agents?subjectDid=${encodeURIComponent('did:hedera:testnet:billing')}`,
    );

    expect(entryByTitle('Credential Revoked')).toHaveClass('tone-danger');
    expect(entryByTitle('Agent Enrolled')).toHaveClass('tone-success');
    // Unknown/odd-cased type still gets a sensible tone from the fallback.
    expect(entryByTitle('jwt issued')).toHaveClass('tone-accent');
    // Structured facts replace the old concatenated description line.
    expect(screen.getByText('orders-api')).toBeInTheDocument();
  });

  it('numbers events oldest-first so the trail reads as a sequence', async () => {
    renderPage();
    await screen.findByText(/Credential Revoked/);

    const titles = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    expect(titles[0]).toContain('1.');
    expect(titles[0]).toContain('Verification Success'); // oldest timestamp
    expect(titles[3]).toContain('4.');
    expect(titles[3]).toContain('Credential Revoked'); // newest timestamp
  });

  // A first call to a service the user has not authorized yet is *expected* to
  // be refused — that refusal is what raises the consent prompt. It must not
  // look like a security failure in the middle of a successful booking.
  it('shows an unauthorized-yet service as Consent Required, not BLOCKED', async () => {
    getAuditLog.mockResolvedValue([
      {
        id: '1',
        eventType: 'AUTHZ_DENIED',
        timestamp: '2026-06-01T12:00:00.000Z',
        subjectDid: 'did:key:agent',
        toolName: 'book_flight',
        result: 'blocked',
        reason: 'NO_GRANT_FOR_THIS_SERVICE',
        resultSummary: 'book_flight needs consent',
      },
    ] as never);
    renderPage();

    const entry = await screen.findByRole('listitem');
    expect(entry.textContent).toContain('Consent Required');
    expect(entry.textContent).not.toContain('BLOCKED');
    expect(entry).toHaveClass('tone-neutral');
  });

  it('shows a genuine scope refusal as Authorization BLOCKED', async () => {
    getAuditLog.mockResolvedValue([
      {
        id: '1',
        eventType: 'AUTHZ_DENIED',
        timestamp: '2026-06-01T12:00:00.000Z',
        subjectDid: 'did:key:agent',
        toolName: 'book_flight',
        requiredScope: 'book:flights',
        effectiveScopes: ['modify:booking'],
        result: 'blocked',
        reason: 'INSUFFICIENT_EFFECTIVE_SCOPE',
        resultSummary: 'book_flight blocked — required scope "book:flights" not present',
      },
    ] as never);
    renderPage();

    const entry = await screen.findByRole('listitem');
    expect(entry.textContent).toContain('Authorization BLOCKED');
    expect(entry).toHaveClass('tone-blocked');
    // The machine-readable code stays visible alongside the prose.
    expect(entry.textContent).toContain('INSUFFICIENT_EFFECTIVE_SCOPE');
    expect(entry.textContent).toContain('modify:booking');
  });

  it('refetches when Refresh is clicked', async () => {
    renderPage();
    await screen.findByText(/Credential Revoked/);
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

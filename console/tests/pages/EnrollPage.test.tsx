// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { EnrollPage } from '../../src/pages/EnrollPage';
import { api } from '../../src/api/client';

vi.mock('../../src/api/client', () => ({
  api: {
    createEnrollmentToken: vi.fn(),
    getAuditLog: vi.fn(),
  },
}));

const createEnrollmentToken = vi.mocked(api.createEnrollmentToken);
const getAuditLog = vi.mocked(api.getAuditLog);

function renderPage() {
  return render(
    <MemoryRouter>
      <EnrollPage />
    </MemoryRouter>,
  );
}

describe('EnrollPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuditLog.mockResolvedValue([]);
  });

  it('mints a token and displays it immediately with the polling status', async () => {
    createEnrollmentToken.mockResolvedValue({
      token: 'enroll:abc123',
      expiresAt: '2026-06-01T00:15:00.000Z',
    });
    renderPage();

    await userEvent.type(screen.getByLabelText(/agent name/i), 'billing-agent');
    await userEvent.type(screen.getByLabelText(/requested scopes/i), 'read:orders');
    await userEvent.click(screen.getByRole('button', { name: /mint enrollment token/i }));

    expect(createEnrollmentToken).toHaveBeenCalledWith({
      agentName: 'billing-agent',
      requestedScopes: ['read:orders'],
    });
    expect(await screen.findByText('enroll:abc123')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/waiting for the agent/i);
  });

  it('returns to the form when minting another token', async () => {
    createEnrollmentToken.mockResolvedValue({
      token: 'enroll:abc123',
      expiresAt: '2026-06-01T00:15:00.000Z',
    });
    renderPage();

    await userEvent.type(screen.getByLabelText(/agent name/i), 'billing-agent');
    await userEvent.type(screen.getByLabelText(/requested scopes/i), 'read:orders');
    await userEvent.click(screen.getByRole('button', { name: /mint enrollment token/i }));
    await screen.findByText('enroll:abc123');

    await userEvent.click(screen.getByRole('button', { name: /mint another token/i }));
    expect(screen.getByLabelText(/agent name/i)).toBeInTheDocument();
    expect(screen.queryByText('enroll:abc123')).not.toBeInTheDocument();
  });

  it('shows an error when minting fails and keeps the form', async () => {
    createEnrollmentToken.mockRejectedValue(new Error('invalid scope'));
    renderPage();

    await userEvent.type(screen.getByLabelText(/agent name/i), 'billing-agent');
    await userEvent.type(screen.getByLabelText(/requested scopes/i), 'bogus');
    await userEvent.click(screen.getByRole('button', { name: /mint enrollment token/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('invalid scope');
    expect(screen.getByLabelText(/agent name/i)).toBeInTheDocument();
  });
});

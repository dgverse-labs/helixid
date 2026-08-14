// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../../src/App';
import { api } from '../../src/api/client';

vi.mock('../../src/api/client', () => ({
  api: {
    listAgents: vi.fn(),
    getAgent: vi.fn(),
    revokeAgent: vi.fn(),
    createEnrollmentToken: vi.fn(),
    getAuditLog: vi.fn(),
  },
}));
const mocked = vi.mocked(api);

function renderApp(initialEntry = '/agents') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <App />
    </MemoryRouter>,
  );
}

describe('Login gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    delete window.__HELIXID_CONFIG__;
    mocked.listAgents.mockResolvedValue([]);
  });

  it('redirects an unauthenticated route to login, then admin/admin passes through', async () => {
    renderApp('/agents');
    await screen.findByRole('heading', { name: /operator sign in/i });

    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // Routed to the originally requested page.
    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
  });

  it('rejects wrong credentials and stays on login', async () => {
    renderApp('/agents');
    await screen.findByRole('heading', { name: /operator sign in/i });

    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'nope');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i);
    expect(screen.queryByRole('heading', { name: 'Agents' })).not.toBeInTheDocument();
  });

  it('honors credentials from runtime config', async () => {
    window.__HELIXID_CONFIG__ = { CONSOLE_USERNAME: 'ops', CONSOLE_PASSWORD: 's3cret' };
    renderApp('/agents');
    await screen.findByRole('heading', { name: /operator sign in/i });

    // The old default no longer works.
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'admin');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    // The configured credentials do.
    const user = screen.getByLabelText(/username/i);
    const pass = screen.getByLabelText(/password/i);
    await userEvent.clear(user);
    await userEvent.type(user, 'ops');
    await userEvent.clear(pass);
    await userEvent.type(pass, 's3cret');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
  });

  it('keeps the session across a remount via the sessionStorage flag', async () => {
    sessionStorage.setItem('helixid.console.auth', 'true');
    renderApp('/agents');
    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeInTheDocument();
    // No login form when already authenticated.
    expect(screen.queryByRole('heading', { name: /operator sign in/i })).not.toBeInTheDocument();
  });
});

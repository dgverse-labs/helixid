// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServicesPage } from '../../src/pages/ServicesPage';
import { api } from '../../src/api/client';

vi.mock('../../src/api/client', () => ({
  api: {
    listServices: vi.fn(),
    registerService: vi.fn(),
  },
}));

const listServices = vi.mocked(api.listServices);
const registerService = vi.mocked(api.registerService);

const orders = {
  serviceName: 'orders-api',
  displayName: 'Orders API',
  verifiedDomain: 'orders.example.com',
  apiEndpoint: 'https://orders.example.com/api',
};

async function fillForm() {
  await userEvent.type(screen.getByLabelText(/service name/i), 'orders-api');
  await userEvent.type(screen.getByLabelText(/display name/i), 'Orders API');
  await userEvent.type(screen.getByLabelText(/verified domain/i), 'orders.example.com');
  await userEvent.type(screen.getByLabelText(/public key/i), 'z6MkExample');
  await userEvent.type(screen.getByLabelText(/api endpoint/i), 'https://orders.example.com/api');
}

describe('ServicesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listServices.mockResolvedValue([orders]);
  });

  it('lists services on mount and refreshes manually', async () => {
    render(<ServicesPage />);

    expect(await screen.findByText('orders-api')).toBeInTheDocument();
    expect(listServices).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(listServices).toHaveBeenCalledTimes(2);
  });

  it('registers a service and re-fetches the list', async () => {
    registerService.mockResolvedValue({ serviceName: 'orders-api' });
    render(<ServicesPage />);
    await screen.findByText('orders-api');

    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /register service/i }));

    expect(registerService).toHaveBeenCalledWith({
      serviceName: 'orders-api',
      displayName: 'Orders API',
      verifiedDomain: 'orders.example.com',
      publicKeyMultibase: 'z6MkExample',
      apiEndpoint: 'https://orders.example.com/api',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/registered orders-api/i);
    await waitFor(() => expect(listServices).toHaveBeenCalledTimes(2));
  });

  it('rejects invalid metadata JSON without calling the API', async () => {
    render(<ServicesPage />);
    await screen.findByText('orders-api');

    await fillForm();
    await userEvent.type(screen.getByLabelText(/metadata/i), 'not-json');
    await userEvent.click(screen.getByRole('button', { name: /register service/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/valid json/i);
    expect(registerService).not.toHaveBeenCalled();
  });

  it('shows a toast when registration fails', async () => {
    registerService.mockRejectedValue(new Error('name already taken'));
    render(<ServicesPage />);
    await screen.findByText('orders-api');

    await fillForm();
    await userEvent.click(screen.getByRole('button', { name: /register service/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/name already taken/i);
  });

  it('surfaces list load errors', async () => {
    listServices.mockRejectedValue(new Error('registry offline'));
    render(<ServicesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('registry offline');
  });
});

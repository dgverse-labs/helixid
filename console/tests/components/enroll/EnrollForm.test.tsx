// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EnrollForm } from '../../../src/components/enroll/EnrollForm';

describe('EnrollForm', () => {
  it('submits a selected scope', async () => {
    const onSubmit = vi.fn();
    render(<EnrollForm onSubmit={onSubmit} submitting={false} />);

    await userEvent.type(screen.getByLabelText(/agent name/i), 'billing-agent');
    await userEvent.type(screen.getByLabelText(/requested scopes/i), 'read');
    await userEvent.click(await screen.findByRole('button', { name: 'read:orders' }));
    await userEvent.type(screen.getByLabelText(/domains/i), 'example.com');
    await userEvent.type(screen.getByLabelText(/max delegation depth/i), '2');
    await userEvent.click(screen.getByRole('button', { name: /mint enrollment token/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      agentName: 'billing-agent',
      requestedScopes: ['read:orders'],
      requestedDomains: ['example.com'],
      maxDelegationDepth: 2,
    });
  });

  it('submits a custom scope that is not in the suggestions', async () => {
    const onSubmit = vi.fn();
    render(<EnrollForm onSubmit={onSubmit} submitting={false} />);

    await userEvent.type(screen.getByLabelText(/agent name/i), 'simple-agent');
    await userEvent.type(screen.getByLabelText(/requested scopes/i), 'custom:billing');
    await userEvent.click(screen.getByRole('button', { name: /mint enrollment token/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      agentName: 'simple-agent',
      requestedScopes: ['custom:billing'],
    });
  });

  it('disables the submit button while submitting', () => {
    render(<EnrollForm onSubmit={vi.fn()} submitting />);
    expect(screen.getByRole('button', { name: /minting/i })).toBeDisabled();
  });
});

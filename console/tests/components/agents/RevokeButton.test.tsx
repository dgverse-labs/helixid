// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RevokeButton } from '../../../src/components/agents/RevokeButton';

describe('RevokeButton', () => {
  it('calls onRevoke when clicked and shows a busy state until it settles', async () => {
    let resolveRevoke!: () => void;
    const onRevoke = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRevoke = resolve;
        }),
    );
    render(<RevokeButton onRevoke={onRevoke} />);

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(onRevoke).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Revoking…' })).toBeDisabled();

    resolveRevoke();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled(),
    );
  });

  it('re-enables even when onRevoke rejects (the page owns the error toast)', async () => {
    const onRevoke = vi.fn().mockRejectedValue(new Error('nope'));
    render(<RevokeButton onRevoke={onRevoke} />);

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled(),
    );
  });

  it('is disabled for non-revocable agents', () => {
    render(<RevokeButton onRevoke={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
  });
});

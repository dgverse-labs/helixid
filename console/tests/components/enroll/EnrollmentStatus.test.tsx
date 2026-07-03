// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { EnrollmentStatus } from '../../../src/components/enroll/EnrollmentStatus';
import { api } from '../../../src/api/client';

vi.mock('../../../src/api/client', () => ({
  api: { getAuditLog: vi.fn() },
}));

const getAuditLog = vi.mocked(api.getAuditLog);
const TOKEN_CREATED_AT = '2026-06-01T00:00:00.000Z';

function renderStatus() {
  return render(
    <MemoryRouter>
      <EnrollmentStatus tokenCreatedAt={TOKEN_CREATED_AT} />
    </MemoryRouter>,
  );
}

describe('EnrollmentStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getAuditLog.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('polls the audit log every 3 seconds for onboarding_complete', async () => {
    renderStatus();
    expect(screen.getByRole('status')).toHaveTextContent(/waiting for the agent/i);

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(getAuditLog).toHaveBeenCalledTimes(1);
    expect(getAuditLog).toHaveBeenCalledWith({
      eventType: 'onboarding_complete',
      since: TOKEN_CREATED_AT,
    });

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(getAuditLog).toHaveBeenCalledTimes(2);
  });

  it('shows success and stops polling once a matching event appears', async () => {
    getAuditLog
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: '1', eventType: 'onboarding_complete', timestamp: '2026-06-01T00:00:05.000Z' },
      ]);
    renderStatus();

    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(screen.getByRole('status')).toHaveTextContent(/agent enrolled/i);
    expect(screen.getByRole('link', { name: /view in agents/i })).toHaveAttribute(
      'href',
      '/agents',
    );

    const calls = getAuditLog.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(getAuditLog).toHaveBeenCalledTimes(calls);
  });

  it('gives up after 2 minutes and tells the operator to check manually', async () => {
    renderStatus();

    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(screen.getByRole('status')).toHaveTextContent(/still waiting/i);

    const calls = getAuditLog.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(getAuditLog).toHaveBeenCalledTimes(calls);
  });

  it('keeps polling through transient errors', async () => {
    getAuditLog.mockRejectedValueOnce(new Error('flaky network'));
    renderStatus();

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(getAuditLog).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status')).toHaveTextContent(/waiting for the agent/i);
  });

  it('cancels the interval when the component unmounts', async () => {
    const { unmount } = renderStatus();

    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(getAuditLog).toHaveBeenCalledTimes(1);

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(getAuditLog).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

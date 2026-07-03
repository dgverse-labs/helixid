// Copyright 2026 DgVerse LLP
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePolling } from '../../src/hooks/usePolling';

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls fn on every interval tick', () => {
    const fn = vi.fn();
    renderHook(() => usePolling(fn, 3_000));

    expect(fn).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(3_000));
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(9_000));
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('stop() halts polling', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => usePolling(fn, 3_000));

    act(() => vi.advanceTimersByTime(3_000));
    expect(fn).toHaveBeenCalledTimes(1);

    act(() => result.current.stop());
    expect(result.current.stopped).toBe(true);

    act(() => vi.advanceTimersByTime(30_000));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.timedOut).toBe(false);
  });

  it('stops with timedOut after timeoutMs', () => {
    const fn = vi.fn();
    const { result } = renderHook(() => usePolling(fn, 3_000, { timeoutMs: 10_000 }));

    act(() => vi.advanceTimersByTime(10_000));
    expect(fn).toHaveBeenCalledTimes(3);
    expect(result.current.timedOut).toBe(true);
    expect(result.current.stopped).toBe(true);

    act(() => vi.advanceTimersByTime(30_000));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('unmounting cancels the interval — no leaked timer', () => {
    const fn = vi.fn();
    const { unmount } = renderHook(() => usePolling(fn, 3_000, { timeoutMs: 120_000 }));

    act(() => vi.advanceTimersByTime(3_000));
    expect(fn).toHaveBeenCalledTimes(1);

    unmount();
    act(() => vi.advanceTimersByTime(60_000));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the latest fn without restarting the interval', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ fn }) => usePolling(fn, 3_000), {
      initialProps: { fn: first },
    });

    act(() => vi.advanceTimersByTime(3_000));
    expect(first).toHaveBeenCalledTimes(1);

    rerender({ fn: second });
    act(() => vi.advanceTimersByTime(3_000));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

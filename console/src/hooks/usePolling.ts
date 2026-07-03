// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UsePollingOptions {
  /** Stop polling after this long; sets timedOut. */
  timeoutMs?: number;
}

export interface UsePollingResult {
  /** Stop polling early (e.g. the awaited event arrived). */
  stop: () => void;
  /** True once polling has stopped for any reason. */
  stopped: boolean;
  /** True when polling stopped because timeoutMs elapsed. */
  timedOut: boolean;
}

/**
 * Calls fn every intervalMs until stop() is called, timeoutMs elapses, or
 * the component unmounts. Plain setInterval with useEffect cleanup — the
 * cleanup is what guarantees no leaked interval when the caller leaves the
 * page (dev spec §5.2).
 */
export function usePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  options: UsePollingOptions = {},
): UsePollingResult {
  const [stopped, setStopped] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const { timeoutMs } = options;

  // Keep the latest fn without restarting the interval when it changes.
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  const stop = useCallback(() => setStopped(true), []);

  useEffect(() => {
    if (stopped) return undefined;

    const interval = setInterval(() => {
      void fnRef.current();
    }, intervalMs);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => {
        setTimedOut(true);
        setStopped(true);
      }, timeoutMs);
    }

    return () => {
      clearInterval(interval);
      if (timeout !== undefined) clearTimeout(timeout);
    };
  }, [stopped, intervalMs, timeoutMs]);

  return { stop, stopped, timedOut };
}

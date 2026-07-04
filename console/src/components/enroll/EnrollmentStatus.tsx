// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { usePolling } from '../../hooks/usePolling';

export const POLL_INTERVAL_MS = 3_000;
export const POLL_TIMEOUT_MS = 120_000;

export interface EnrollmentStatusProps {
  /** ISO timestamp of token creation; only newer events count. */
  tokenCreatedAt: string;
}

/**
 * Watches the audit log for the onboarding_complete event that consumes
 * the freshly minted token (dev spec §5.2). This is the one deliberate
 * exception to the no-auto-polling rule (§8).
 */
export function EnrollmentStatus({ tokenCreatedAt }: EnrollmentStatusProps) {
  const [enrolled, setEnrolled] = useState(false);
  // Guards against a late in-flight response after detection or timeout.
  const doneRef = useRef(false);

  const { stop, timedOut } = usePolling(
    useCallback(async () => {
      if (doneRef.current) return;
      try {
        const events = await api.getAuditLog({
          eventType: 'onboarding_complete',
          since: tokenCreatedAt,
        });
        if (events.length > 0 && !doneRef.current) {
          doneRef.current = true;
          setEnrolled(true);
        }
      } catch {
        // Transient poll failures are fine; the next tick retries.
      }
    }, [tokenCreatedAt]),
    POLL_INTERVAL_MS,
    { timeoutMs: POLL_TIMEOUT_MS },
  );

  // Cancel the interval as soon as the enrollment event is detected.
  useEffect(() => {
    if (enrolled) stop();
  }, [enrolled, stop]);

  if (enrolled) {
    return (
      <p role="status" className="enrollment-success">
        ✅ Agent enrolled — <Link to="/agents">view in Agents</Link>
      </p>
    );
  }

  if (timedOut) {
    return (
      <p role="status" className="enrollment-timeout">
        Still waiting — check the <Link to="/agents">Agents list</Link> manually.
      </p>
    );
  }

  return (
    <p role="status" className="enrollment-waiting">
      Waiting for the agent to complete onboarding…
    </p>
  );
}

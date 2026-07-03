// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';

export interface AuditRefreshValue {
  /** Increments every time refreshAudit() is called; AuditRail re-fetches on change. */
  refreshKey: number;
  /** Called by state-changing actions (revoke, enrollment) so the rail updates. */
  refreshAudit: () => void;
}

export const AuditRefreshContext = createContext<AuditRefreshValue>({
  refreshKey: 0,
  refreshAudit: () => {},
});

export function AuditRefreshProvider({ children }: { children: ReactNode }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshAudit = useCallback(() => setRefreshKey((key) => key + 1), []);
  const value = useMemo(() => ({ refreshKey, refreshAudit }), [refreshKey, refreshAudit]);
  return <AuditRefreshContext.Provider value={value}>{children}</AuditRefreshContext.Provider>;
}

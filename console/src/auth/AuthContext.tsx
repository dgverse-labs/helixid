// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import { getAuthConfig } from '../runtimeConfig';

const STORAGE_KEY = 'helixid.console.auth';

export interface AuthValue {
  isAuthenticated: boolean;
  /** Validates against runtime-config credentials; returns success. */
  login: (username: string, password: string) => boolean;
  logout: () => void;
}

export const AuthContext = createContext<AuthValue>({
  isAuthenticated: false,
  login: () => false,
  logout: () => {},
});

/**
 * Client-side access gate (dev spec §8 override). This is a gate, not a
 * security boundary — the ADMIN_API_KEY still ships in runtime config.
 * The session flag lives in sessionStorage so it survives a reload within
 * the tab but not a new tab / restart.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setAuthenticated] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const login = useCallback((username: string, password: string): boolean => {
    const expected = getAuthConfig();
    if (username === expected.username && password === expected.password) {
      try {
        sessionStorage.setItem(STORAGE_KEY, 'true');
      } catch {
        // Session flag is best-effort; state still reflects the login.
      }
      setAuthenticated(true);
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore; clearing state below is what gates the UI.
    }
    setAuthenticated(false);
  }, []);

  const value = useMemo(
    () => ({ isAuthenticated, login, logout }),
    [isAuthenticated, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

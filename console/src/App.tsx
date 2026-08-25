// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { Navigate, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from './theme/ThemeContext';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { AccountLoginPage } from './pages/account/AccountLoginPage';
import { AccountRegisterPage } from './pages/account/AccountRegisterPage';
import { AgentsPage } from './pages/AgentsPage';
import { EnrollPage } from './pages/EnrollPage';
import { AuditPage } from './pages/AuditPage';

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/account/login" element={<AccountLoginPage />} />
          <Route path="/account/register" element={<AccountRegisterPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Navigate to="/agents" replace />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/enroll" element={<EnrollPage />} />
              <Route path="/audit" element={<AuditPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/agents" replace />} />
        </Routes>
      </AuthProvider>
    </ThemeProvider>
  );
}

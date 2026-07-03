// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { Navigate, Route, Routes } from 'react-router-dom';
import { AuditRefreshProvider } from './context/AuditRefreshContext';
import { AppLayout } from './components/layout/AppLayout';
import { AgentsPage } from './pages/AgentsPage';
import { EnrollPage } from './pages/EnrollPage';
import { ServicesPage } from './pages/ServicesPage';

export function App() {
  return (
    <AuditRefreshProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/agents" replace />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/enroll" element={<EnrollPage />} />
          <Route path="/services" element={<ServicesPage />} />
        </Route>
      </Routes>
    </AuditRefreshProvider>
  );
}

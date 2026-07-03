// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { NavLink, Outlet } from 'react-router-dom';
import { AuditRail } from './AuditRail';

export function AppLayout() {
  return (
    <div className="app-layout">
      <header className="app-header">
        <span className="app-title">HelixID Console</span>
        <nav className="app-nav">
          <NavLink to="/agents">Agents</NavLink>
          <NavLink to="/enroll">Enroll</NavLink>
          <NavLink to="/services">Services</NavLink>
        </nav>
      </header>
      <div className="app-body">
        <main className="app-main">
          <Outlet />
        </main>
        <AuditRail />
      </div>
    </div>
  );
}

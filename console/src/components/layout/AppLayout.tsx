// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { NavLink, Outlet } from 'react-router-dom';
import { AuditRail } from './AuditRail';
import { ActivityIcon, BotIcon, KeyIcon } from './icons';
import helixMark from '../../assets/helix-mark.png';
import helixWordmark from '../../assets/helix-wordmark.png';

export function AppLayout() {
  return (
    <div className="app-layout">
      <aside className="app-sidebar">
        <div className="app-logo">
          <img className="logo-mark" src={helixMark} alt="" />
          <img className="logo-word" src={helixWordmark} alt="HelixID" />
        </div>
        <nav className="app-nav">
          <NavLink to="/agents">
            <BotIcon />
            Agents
          </NavLink>
          <NavLink to="/enroll">
            <KeyIcon />
            Enroll
          </NavLink>
          <NavLink to="/services">
            <ActivityIcon />
            Services
          </NavLink>
        </nav>
        <div className="sidebar-foot">operator console</div>
      </aside>
      <div className="app-body">
        <main className="app-main">
          <Outlet />
        </main>
        <AuditRail />
      </div>
    </div>
  );
}

// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

/** Gate for protected routes: unauthenticated access redirects to /login. */
export function RequireAuth() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    // Remember where the operator was headed so login can send them back.
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}

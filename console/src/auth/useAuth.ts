// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

import { useContext } from 'react';
import { AuthContext, type AuthValue } from './AuthContext';

export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

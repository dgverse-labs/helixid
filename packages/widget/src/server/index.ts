// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

// Server-only entry point. Imported by the SP's own backend route (see the
// Part B contract in this package's README) — never bundled into the browser,
// because it talks to the SP's internal MCP server.
export {
  ACCEPT_TERMS_SCOPE,
  humanizeScope,
  resolveConsentScopes,
  type ResolveConsentScopesOptions,
} from './resolve-scopes.js';
export type { CuratedScopeEntry, ScopeOption } from '../types.js';

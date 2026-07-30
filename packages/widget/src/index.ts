// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0

// Browser-safe entry point: types and the headless consent controller.
// Server-side scope resolution lives behind `@helixid/widget/server` so the
// MCP-facing code is never bundled into the browser.
export {
  DEFAULT_DURABILITY_OPTIONS,
  type ConsentSelection,
  type CuratedScopeEntry,
  type DurabilityOption,
  type HelixConsentWidgetProps,
  type ScopeOption,
} from './types.js';

export {
  createConsentController,
  type ConsentController,
  type ConsentControllerState,
  type ConsentStatus,
} from './controller.js';

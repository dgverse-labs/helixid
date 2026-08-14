// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * One selectable permission on the consent screen.
 *
 * Produced by `resolveConsentScopes()` (see `@helixid/widget/server`) and
 * consumed by the widget either pre-resolved (`scopeOptions`) or fetched at
 * mount (`scopesEndpoint`).
 */
export interface ScopeOption {
  scope: string;
  label: string;
  description?: string;
  defaultChecked?: boolean;
  required?: boolean;
}

/**
 * An SP-owned catalog entry. The SP supplies these — HelixID never invents
 * scope strings (register D8).
 */
export interface CuratedScopeEntry {
  scope: string;
  label: string;
  description?: string;
  required?: boolean;
}

export interface DurabilityOption {
  value: 'standing' | 'session';
  label: string;
  description?: string;
}

export interface HelixConsentWidgetProps {
  agentDid: string;
  agentName: string;
  agentAvatarUrl?: string;
  userIdentifier: string; // DID or email, per §2.6 — must match the form
  // the grant captures at consent time, or
  // VP verification's user-match fails later
  serviceDid: string;

  // Provide ONE of these two:
  scopeOptions?: ScopeOption[]; // pre-resolved server-side (SSR path)
  scopesEndpoint?: string; // widget fetches from this at mount
  // (client round-trip path) — see Part B

  durabilityOptions?: DurabilityOption[]; // defaults below if omitted
  defaultDurability?: 'standing' | 'session'; // defaults to 'standing'

  onAccept: (selection: ConsentSelection) => Promise<void> | void;
  onDecline: () => void;
}

export interface ConsentSelection {
  scopes: string[];
  durability: 'standing' | 'session';
}

export const DEFAULT_DURABILITY_OPTIONS: DurabilityOption[] = [
  { value: 'standing', label: 'Keep this connected until I revoke it' },
  { value: 'session', label: 'Only for this session' },
];

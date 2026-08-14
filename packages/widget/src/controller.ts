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

import {
  DEFAULT_DURABILITY_OPTIONS,
  type ConsentSelection,
  type DurabilityOption,
  type HelixConsentWidgetProps,
  type ScopeOption,
} from './types.js';

/**
 * `error` is the D3 state: the `scopesEndpoint` fetch failed (non-200,
 * malformed JSON, or network failure). Accept is disabled, Decline stays
 * available, and there is no retry.
 */
export type ConsentStatus = 'loading' | 'ready' | 'error';

export interface ConsentControllerState {
  status: ConsentStatus;
  scopeOptions: ScopeOption[];
  /** Scopes currently checked, always including every `required` scope. */
  selectedScopes: string[];
  durability: 'standing' | 'session';
  /** Always the full list — a `defaultDurability` pre-selects, it never hides. */
  durabilityOptions: DurabilityOption[];
  canAccept: boolean;
  error?: string;
}

export interface ConsentController {
  getState(): ConsentControllerState;
  subscribe(listener: (state: ConsentControllerState) => void): () => void;
  /** Mount hook: resolves scopes from `scopesEndpoint` when that is the source. */
  load(): Promise<void>;
  toggleScope(scope: string): void;
  setDurability(value: 'standing' | 'session'): void;
  accept(): Promise<void>;
  decline(): void;
}

function initialSelection(scopeOptions: ScopeOption[]): string[] {
  // Required scopes are always in. Optional scopes start checked unless the
  // resolver explicitly opted them out, so that Part C's "whichever optional
  // ones were left checked at submit time" describes an unchecking gesture.
  return scopeOptions
    .filter((option) => option.required === true || option.defaultChecked !== false)
    .map((option) => option.scope);
}

function withAgentDid(endpoint: string, agentDid: string): string {
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}agentDid=${encodeURIComponent(agentDid)}`;
}

export function createConsentController(props: HelixConsentWidgetProps): ConsentController {
  const hasInlineOptions = Array.isArray(props.scopeOptions);
  if (!hasInlineOptions && !props.scopesEndpoint) {
    // Caller integration error, not a state to render around.
    throw new Error(
      'HelixConsentWidget requires either scopeOptions or scopesEndpoint. Neither was provided.',
    );
  }

  const durabilityOptions = props.durabilityOptions ?? DEFAULT_DURABILITY_OPTIONS;
  const inlineOptions = props.scopeOptions ?? [];

  let state: ConsentControllerState = hasInlineOptions
    ? {
        status: 'ready',
        scopeOptions: inlineOptions,
        selectedScopes: initialSelection(inlineOptions),
        durability: props.defaultDurability ?? 'standing',
        durabilityOptions,
        canAccept: true,
      }
    : {
        status: 'loading',
        scopeOptions: [],
        selectedScopes: [],
        durability: props.defaultDurability ?? 'standing',
        durabilityOptions,
        canAccept: false,
      };

  const listeners = new Set<(next: ConsentControllerState) => void>();
  const setState = (patch: Partial<ConsentControllerState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };

  const failClosed = (message: string): void => {
    setState({
      status: 'error',
      scopeOptions: [],
      selectedScopes: [],
      canAccept: false,
      error: message,
    });
  };

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async load() {
      // scopeOptions wins outright: scopesEndpoint is treated as unused and
      // no fetch is issued.
      if (hasInlineOptions) return;

      const endpoint = props.scopesEndpoint;
      if (!endpoint) return;

      try {
        // agentDid travels with the request for audit correlation only — the
        // route must not let it change the catalog it returns (register D4).
        const response = await fetch(withAgentDid(endpoint, props.agentDid), {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        });
        if (!response.ok) {
          failClosed(`Scope resolution failed with HTTP ${response.status}`);
          return;
        }
        const body = (await response.json()) as { scopeOptions?: unknown };
        if (!Array.isArray(body?.scopeOptions)) {
          failClosed('Scope resolution returned an unexpected response shape');
          return;
        }
        const scopeOptions = body.scopeOptions as ScopeOption[];
        setState({
          status: 'ready',
          scopeOptions,
          selectedScopes: initialSelection(scopeOptions),
          canAccept: true,
        });
      } catch (error) {
        // Network failure or malformed JSON. No retry (register D3).
        failClosed(error instanceof Error ? error.message : 'Scope resolution failed');
      }
    },

    toggleScope(scope) {
      const option = state.scopeOptions.find((entry) => entry.scope === scope);
      // Required scopes cannot be unchecked; Decline is the way not to proceed.
      if (!option || option.required === true) return;

      const selected = state.selectedScopes.includes(scope)
        ? state.selectedScopes.filter((entry) => entry !== scope)
        : [...state.selectedScopes, scope];
      setState({ selectedScopes: selected });
    },

    setDurability(value) {
      setState({ durability: value });
    },

    async accept() {
      if (!state.canAccept) return;
      const selection: ConsentSelection = {
        scopes: [...state.selectedScopes],
        durability: state.durability,
      };
      await props.onAccept(selection);
    },

    decline() {
      // Available in every state, including the D3 error state.
      props.onDecline();
    },
  };
}

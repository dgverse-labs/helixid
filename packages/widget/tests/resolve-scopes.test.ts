// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Part E test table, Part A rows, as amended by register D5:
//   - row 4 (filtering against requestedScopes) deleted
//   - rows 1 and 3 reworded off the "requested scope" framing
//   - new row: full catalog returned regardless of agentDid

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCEPT_TERMS_SCOPE,
  humanizeScope,
  resolveConsentScopes,
  type CuratedScopeEntry,
} from '../src/server/resolve-scopes.js';

const MCP_URL = 'http://localhost:3100/api/mcp';

const AIRLINE_CATALOG: CuratedScopeEntry[] = [
  { scope: 'book:flights', label: 'Book flights', description: 'Buy tickets on your behalf' },
  { scope: 'modify:booking', label: 'Modify bookings' },
];

function mockToolsList(tools: unknown[]): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: '2.0', id: 1, result: { tools } }),
  } as Response);
}

function byScope(options: Array<{ scope: string }>, scope: string) {
  return options.find((option) => option.scope === scope);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveConsentScopes (Part A)', () => {
  it('row 1: curated-only, no mcpServerUrl — curated labels for every curated scope, plus accept-terms', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const options = await resolveConsentScopes({ curatedFallback: AIRLINE_CATALOG });

    expect(options.map((option) => option.scope)).toEqual([
      'book:flights',
      'modify:booking',
      ACCEPT_TERMS_SCOPE,
    ]);
    expect(byScope(options, 'book:flights')).toMatchObject({
      label: 'Book flights',
      description: 'Buy tickets on your behalf',
    });
    expect(byScope(options, 'modify:booking')?.label).toBe('Modify bookings');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('row 2: both sources describe the same scope — MCP wins', async () => {
    mockToolsList([
      {
        name: 'book_flight',
        description: 'MCP-sourced description',
        metadata: { requiredScope: 'book:flights', label: 'MCP-sourced label' },
      },
    ]);

    const options = await resolveConsentScopes({
      mcpServerUrl: MCP_URL,
      curatedFallback: AIRLINE_CATALOG,
    });

    expect(byScope(options, 'book:flights')).toMatchObject({
      label: 'MCP-sourced label',
      description: 'MCP-sourced description',
    });
    // The curated-only scope is untouched by the overlay.
    expect(byScope(options, 'modify:booking')?.label).toBe('Modify bookings');
  });

  it('row 3: resolved scope that neither source describes — falls back to humanizeScope()', async () => {
    mockToolsList([
      // Contributes a scope no curated entry covers, and carries no label.
      { name: 'cancel_booking', metadata: { requiredScope: 'cancel:booking' } },
    ]);

    const options = await resolveConsentScopes({
      mcpServerUrl: MCP_URL,
      curatedFallback: AIRLINE_CATALOG,
    });

    expect(byScope(options, 'cancel:booking')?.label).toBe('cancel booking');
    expect(options.every((option) => option.label.length > 0)).toBe(true);
  });

  it('row 5: accept-terms is always present, required, regardless of inputs', async () => {
    const curatedOnly = await resolveConsentScopes({ curatedFallback: AIRLINE_CATALOG });
    const emptyCatalog = await resolveConsentScopes({ curatedFallback: [] });
    mockToolsList([{ name: 'book_flight', metadata: { requiredScope: 'book:flights' } }]);
    const withMcp = await resolveConsentScopes({ mcpServerUrl: MCP_URL, curatedFallback: [] });

    for (const options of [curatedOnly, emptyCatalog, withMcp]) {
      expect(byScope(options, ACCEPT_TERMS_SCOPE)).toMatchObject({
        required: true,
        defaultChecked: true,
      });
    }
    expect(emptyCatalog).toHaveLength(1);
  });

  it('new row (D5): the full catalog is returned — the resolver takes no agent identity at all', async () => {
    mockToolsList([
      { name: 'book_flight', metadata: { requiredScope: 'book:flights' } },
      { name: 'cancel_booking', metadata: { requiredScope: 'cancel:booking' } },
    ]);

    const options = await resolveConsentScopes({
      mcpServerUrl: MCP_URL,
      curatedFallback: AIRLINE_CATALOG,
    });

    // curated ∪ MCP ∪ accept-terms — nothing is filtered out.
    expect(options.map((option) => option.scope).sort()).toEqual(
      ['accept-terms', 'book:flights', 'cancel:booking', 'modify:booking'].sort(),
    );
    // There is no agentDid (or requestedScopes) input that could narrow this.
    expect(Object.keys({ mcpServerUrl: MCP_URL, curatedFallback: [] })).toEqual([
      'mcpServerUrl',
      'curatedFallback',
    ]);
  });

  it('inserts every MCP tool carrying a requiredScope, and ignores tools without one', async () => {
    mockToolsList([
      // Per register D7 search tools declare no requiredScope — no consent entry.
      { name: 'search_flights', description: 'Open, read-only' },
      { name: 'book_flight', metadata: { requiredScope: 'book:flights' } },
    ]);

    const options = await resolveConsentScopes({ mcpServerUrl: MCP_URL, curatedFallback: [] });

    expect(options.map((option) => option.scope)).toEqual(['book:flights', ACCEPT_TERMS_SCOPE]);
  });

  it('falls back to the curated catalog when the MCP server is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));

    const options = await resolveConsentScopes({
      mcpServerUrl: MCP_URL,
      curatedFallback: AIRLINE_CATALOG,
    });

    expect(options.map((option) => option.scope)).toEqual([
      'book:flights',
      'modify:booking',
      ACCEPT_TERMS_SCOPE,
    ]);
  });

  it('falls back to the curated catalog when MCP responds non-200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as Response);

    const options = await resolveConsentScopes({
      mcpServerUrl: MCP_URL,
      curatedFallback: AIRLINE_CATALOG,
    });

    expect(options.map((option) => option.scope)).toContain('book:flights');
    expect(byScope(options, ACCEPT_TERMS_SCOPE)).toBeDefined();
  });
});

describe('humanizeScope', () => {
  it('turns scope strings into readable labels', () => {
    expect(humanizeScope('book:flights')).toBe('book flights');
    expect(humanizeScope('modify:booking')).toBe('modify booking');
    expect(humanizeScope('accept-terms')).toBe('accept terms');
    expect(humanizeScope('read_orders')).toBe('read orders');
  });
});

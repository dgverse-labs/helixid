// Copyright 2026 DgVerse LLP
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Part E test table, Part C rows, plus the fetch-failure row resolved by
// register D3 (error state, Accept disabled, Decline available, no retry).

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsentController } from '../src/controller.js';
import {
  DEFAULT_DURABILITY_OPTIONS,
  type ConsentSelection,
  type HelixConsentWidgetProps,
  type ScopeOption,
} from '../src/types.js';

const SCOPE_OPTIONS: ScopeOption[] = [
  { scope: 'book:flights', label: 'Book flights' },
  { scope: 'modify:booking', label: 'Modify bookings' },
  { scope: 'accept-terms', label: 'Accept the terms', required: true, defaultChecked: true },
];

function makeProps(overrides: Partial<HelixConsentWidgetProps> = {}) {
  const onAccept = vi.fn<(selection: ConsentSelection) => void>();
  const onDecline = vi.fn();
  const props: HelixConsentWidgetProps = {
    agentDid: 'did:key:zAgent',
    agentName: 'Travel Planner',
    userIdentifier: 'did:web:user.example',
    serviceDid: 'did:web:airline.example',
    scopeOptions: SCOPE_OPTIONS,
    onAccept,
    onDecline,
    ...overrides,
  };
  return { props, onAccept, onDecline };
}

function mockScopesResponse(scopeOptions: ScopeOption[]): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ scopeOptions }),
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('consent controller (Part C)', () => {
  it('scopeOptions wins over scopesEndpoint and no fetch occurs', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { props } = makeProps({ scopesEndpoint: '/api/consent/scopes' });

    const controller = createConsentController(props);
    await controller.load();

    expect(controller.getState().status).toBe('ready');
    expect(controller.getState().scopeOptions).toEqual(SCOPE_OPTIONS);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws at mount when neither scopeOptions nor scopesEndpoint is given', () => {
    const { props } = makeProps();
    delete (props as Partial<HelixConsentWidgetProps>).scopeOptions;

    expect(() => createConsentController(props)).toThrowError(
      /requires either scopeOptions or scopesEndpoint/,
    );
  });

  it('required scopes cannot be unchecked and appear in every onAccept payload', async () => {
    const { props, onAccept } = makeProps();
    const controller = createConsentController(props);
    await controller.load();

    controller.toggleScope('accept-terms');
    expect(controller.getState().selectedScopes).toContain('accept-terms');

    // Uncheck both optional scopes; the required one survives.
    controller.toggleScope('book:flights');
    controller.toggleScope('modify:booking');
    expect(controller.getState().selectedScopes).toEqual(['accept-terms']);

    await controller.accept();
    expect(onAccept).toHaveBeenCalledWith({
      scopes: ['accept-terms'],
      durability: 'standing',
    });
  });

  it('optional scopes start checked and can be toggled back on', async () => {
    const { props, onAccept } = makeProps();
    const controller = createConsentController(props);
    await controller.load();

    expect(controller.getState().selectedScopes).toEqual([
      'book:flights',
      'modify:booking',
      'accept-terms',
    ]);

    controller.toggleScope('book:flights');
    expect(controller.getState().selectedScopes).not.toContain('book:flights');
    controller.toggleScope('book:flights');
    expect(controller.getState().selectedScopes).toContain('book:flights');

    await controller.accept();
    expect(onAccept.mock.calls[0]?.[0].scopes).toContain('book:flights');
  });

  it('offers both durability options even when defaultDurability is set, and reports the selection', async () => {
    const { props, onAccept } = makeProps({ defaultDurability: 'session' });
    const controller = createConsentController(props);
    await controller.load();

    expect(controller.getState().durability).toBe('session');
    // Pre-selecting one never removes the other.
    expect(controller.getState().durabilityOptions).toEqual(DEFAULT_DURABILITY_OPTIONS);
    expect(controller.getState().durabilityOptions.map((option) => option.value)).toEqual([
      'standing',
      'session',
    ]);

    controller.setDurability('standing');
    await controller.accept();
    expect(onAccept.mock.calls[0]?.[0].durability).toBe('standing');
  });

  it('defaults durability to standing when defaultDurability is omitted', async () => {
    const { props } = makeProps();
    const controller = createConsentController(props);
    await controller.load();
    expect(controller.getState().durability).toBe('standing');
  });

  it('accepts a caller-supplied durabilityOptions list', async () => {
    const custom = [
      { value: 'standing' as const, label: 'Always' },
      { value: 'session' as const, label: 'Just now' },
    ];
    const { props } = makeProps({ durabilityOptions: custom });
    const controller = createConsentController(props);
    await controller.load();
    expect(controller.getState().durabilityOptions).toEqual(custom);
  });
});

describe('scopesEndpoint fetch path (register D3)', () => {
  it('resolves scopes from the endpoint and sends agentDid for audit correlation', async () => {
    const fetchSpy = mockScopesResponse(SCOPE_OPTIONS);
    const { props } = makeProps({ scopesEndpoint: '/api/consent/scopes' });
    delete (props as Partial<HelixConsentWidgetProps>).scopeOptions;

    const controller = createConsentController(props);
    await controller.load();

    expect(controller.getState().status).toBe('ready');
    expect(controller.getState().canAccept).toBe(true);
    expect(controller.getState().scopeOptions).toEqual(SCOPE_OPTIONS);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/consent/scopes?agentDid=did%3Akey%3AzAgent',
    );
  });

  it('appends agentDid correctly to an endpoint that already has a query string', async () => {
    const fetchSpy = mockScopesResponse(SCOPE_OPTIONS);
    const { props } = makeProps({ scopesEndpoint: '/api/consent/scopes?locale=en' });
    delete (props as Partial<HelixConsentWidgetProps>).scopeOptions;

    await createConsentController(props).load();

    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      '/api/consent/scopes?locale=en&agentDid=did%3Akey%3AzAgent',
    );
  });

  it('returns the same catalog regardless of agentDid (D4 — correlation only)', async () => {
    const fetchSpy = mockScopesResponse(SCOPE_OPTIONS);

    const first = makeProps({ scopesEndpoint: '/api/consent/scopes', agentDid: 'did:key:zAgentOne' });
    delete (first.props as Partial<HelixConsentWidgetProps>).scopeOptions;
    const second = makeProps({
      scopesEndpoint: '/api/consent/scopes',
      agentDid: 'did:key:zAgentTwo',
    });
    delete (second.props as Partial<HelixConsentWidgetProps>).scopeOptions;

    const controllerOne = createConsentController(first.props);
    const controllerTwo = createConsentController(second.props);
    await controllerOne.load();
    await controllerTwo.load();

    // Both agent identities were transmitted...
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('zAgentOne');
    expect(String(fetchSpy.mock.calls[1]?.[0])).toContain('zAgentTwo');
    // ...and neither changed the catalog.
    expect(controllerOne.getState().scopeOptions).toEqual(controllerTwo.getState().scopeOptions);
  });

  it('non-200 response — error state, Accept disabled, Decline still available', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);
    const { props, onDecline } = makeProps({ scopesEndpoint: '/api/consent/scopes' });
    delete (props as Partial<HelixConsentWidgetProps>).scopeOptions;

    const controller = createConsentController(props);
    await controller.load();

    expect(controller.getState().status).toBe('error');
    expect(controller.getState().canAccept).toBe(false);
    expect(controller.getState().error).toContain('500');

    controller.decline();
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('malformed JSON — error state, Accept disabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0');
      },
    } as unknown as Response);
    const { props } = makeProps({ scopesEndpoint: '/api/consent/scopes' });
    delete (props as Partial<HelixConsentWidgetProps>).scopeOptions;

    const controller = createConsentController(props);
    await controller.load();

    expect(controller.getState().status).toBe('error');
    expect(controller.getState().canAccept).toBe(false);
  });

  it('valid JSON of the wrong shape — error state, Accept disabled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ somethingElse: true }),
    } as Response);
    const { props } = makeProps({ scopesEndpoint: '/api/consent/scopes' });
    delete (props as Partial<HelixConsentWidgetProps>).scopeOptions;

    const controller = createConsentController(props);
    await controller.load();

    expect(controller.getState().status).toBe('error');
    expect(controller.getState().canAccept).toBe(false);
  });

  it('network failure — error state, Accept disabled, and accept() is inert', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'));
    const { props, onAccept, onDecline } = makeProps({ scopesEndpoint: '/api/consent/scopes' });
    delete (props as Partial<HelixConsentWidgetProps>).scopeOptions;

    const controller = createConsentController(props);
    await controller.load();

    expect(controller.getState().status).toBe('error');
    expect(controller.getState().canAccept).toBe(false);

    await controller.accept();
    expect(onAccept).not.toHaveBeenCalled();

    controller.decline();
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('does not retry a failed fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Failed to fetch'));
    const { props } = makeProps({ scopesEndpoint: '/api/consent/scopes' });
    delete (props as Partial<HelixConsentWidgetProps>).scopeOptions;

    await createConsentController(props).load();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers as state advances', async () => {
    mockScopesResponse(SCOPE_OPTIONS);
    const { props } = makeProps({ scopesEndpoint: '/api/consent/scopes' });
    delete (props as Partial<HelixConsentWidgetProps>).scopeOptions;

    const controller = createConsentController(props);
    const seen: string[] = [];
    const unsubscribe = controller.subscribe((state) => seen.push(state.status));

    expect(controller.getState().status).toBe('loading');
    await controller.load();

    expect(seen).toContain('ready');
    unsubscribe();
  });
});

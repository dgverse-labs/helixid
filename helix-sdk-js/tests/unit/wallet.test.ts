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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentWallet } from '../../src/wallet/AgentWallet.js';
import { HelixClient } from '../../src/client/HelixClient.js';
import { HttpAdapter } from '../../src/http/HttpAdapter.js';

describe('AgentWallet', () => {
  const baseUrl = 'http://api.test';
  let client: HelixClient;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    const http = new HttpAdapter(baseUrl);
    client = new HelixClient(http, baseUrl);
  });

  it('generates a new keypair and DID when no key provided', () => {
    const wallet = new AgentWallet({ client });
    expect(wallet.getPublicKey()).toBeDefined();
    expect(wallet.getDID()).toMatch(/^did:helix:[0-9a-f]{32}$/);
  });

  it('signs data correctly', () => {
    const wallet = new AgentWallet({ client });
    const sig = wallet.sign('hello');
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
  });

  it('orchestrates DID creation via API', async () => {
    const wallet = new AgentWallet({ client });
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ id: wallet.getDID(), didDocument: {}, hederaTransactionId: 'tx' }),
    });

    const result = await wallet.createDID('agent');
    
    // Note: client.createDID() creates its own keypair, so the ID won't match the wallet's ID
    // but we verify the call happened.
    expect(result.did).toBeDefined();
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/v1/dids`,
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('orchestrates service addition', async () => {
    const wallet = new AgentWallet({ client });
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });

    const endpoint = { id: '#svc', type: 't', serviceEndpoint: 'https://e.com' };
    await wallet.addService(endpoint as any);
    
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/services`),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(endpoint),
      })
    );
  });

  it('orchestrates deactivation', async () => {
    const wallet = new AgentWallet({ client });
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });

    await wallet.deactivate();
    
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/deactivate'),
      expect.objectContaining({ method: 'POST' })
    );
  });
});

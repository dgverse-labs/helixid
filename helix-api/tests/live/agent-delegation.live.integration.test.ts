import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { AgentWallet, HelixClient, delegate } from '@helixid/sdk-js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LIVE_HEDERA_TIMEOUT_MS,
  buildAndSignVP,
  onboardLiveAgent,
  resetLiveTestDatabase,
  startLiveApi,
  type LiveApi,
} from '../utils/liveApi.js';

// Agent-to-agent delegation (a "sub-agent") — distinct from the consent-grant
// flow: here the delegator is itself an onboarded agent, delegating a subset
// of its own privilege scopes to another agent it controls, via the SDK's
// prepare/finalize-backed delegate() helper (payload construction happens
// server-side; only the signature is produced locally — see
// docs/proposal-sdk-api-only.md).
describe('Agent Delegation Live Integration', () => {
  let api: LiveApi;

  beforeAll(async () => {
    await resetLiveTestDatabase();
    api = await startLiveApi();
  });

  afterAll(async () => {
    await api?.stop();
  });

  it('lets a delegated sub-agent present a VP whose delegationChain shows the parent', async () => {
    const client = new HelixClient(api.baseUrl, { adminApiKey: api.adminApiKey });
    const http = supertest(api.baseUrl);
    const delegator = await onboardLiveAgent(api, client, {
      agentName: 'Live Delegator Agent',
      requestedScopes: ['read:orders', 'write:orders'],
      requestedDomains: ['https://live-delegator.agent.example.com'],
      passphrase: 'live-delegator-passphrase',
      maxDelegationDepth: 1,
    });

    const dir = await mkdtemp(join(tmpdir(), 'helix-live-subagent-'));
    try {
      // The delegator's own wallet, holding its onboarded VC — delegate()
      // defaults to wallet.credentials[0] as the VC it delegates from.
      // Static AgentWallet.load() — not the instance `.load()` used elsewhere
      // for raw decryption — because delegate() needs a real AgentWallet
      // (wallet.getDID(), wallet.sign(), wallet.client), not plain wallet data.
      const delegatorWallet = await AgentWallet.load(delegator.walletPath, 'live-delegator-passphrase', client);
      const subAgentWallet = await AgentWallet.create(join(dir, 'sub-agent.json'), 'sub-agent-pw', client);

      const subAgentVC = await delegate(
        {
          to: subAgentWallet.getDID(),
          scopes: ['read:orders'],
          expiresIn: 3600,
        },
        delegatorWallet,
      );

      const signedVP = await buildAndSignVP(
        [subAgentVC],
        subAgentWallet.getDID(),
        subAgentWallet.getPrivateKeyHex(),
        { targetService: 'amazon', userDid: 'did:hedera:testnet:live-user-placeholder' },
      );

      const verifyRes = await http.post('/v1/vp/verify').send({ signedVP });
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.body).toMatchObject({
        valid: true,
        agentDid: subAgentWallet.getDID(),
        privilegeScopes: ['read:orders'],
        effectiveScopes: ['read:orders'],
      });
      expect(verifyRes.body.delegationChain).toHaveLength(2);
      expect(verifyRes.body.delegationChain[0]).toMatchObject({ subject: delegator.did });
      expect(verifyRes.body.delegationChain[1]).toMatchObject({ subject: subAgentWallet.getDID() });
    } finally {
      await delegator.cleanup();
      await rm(dir, { recursive: true, force: true });
    }
  }, LIVE_HEDERA_TIMEOUT_MS);

  it('rejects delegation past the parent VC\'s maxDelegationDepth', async () => {
    const client = new HelixClient(api.baseUrl, { adminApiKey: api.adminApiKey });
    const http = supertest(api.baseUrl);
    // maxDelegationDepth defaults to 0 unless requested — a fresh onboarded
    // agent (no explicit depth) cannot delegate at all.
    const delegator = await onboardLiveAgent(api, client, {
      agentName: 'Live No-Delegation Agent',
      requestedScopes: ['read:orders'],
      requestedDomains: ['https://live-no-delegation.agent.example.com'],
      passphrase: 'live-no-delegation-passphrase',
    });

    const dir = await mkdtemp(join(tmpdir(), 'helix-live-subagent-reject-'));
    try {
      const delegatorWallet = await AgentWallet.load(delegator.walletPath, 'live-no-delegation-passphrase', client);
      const subAgentWallet = await AgentWallet.create(join(dir, 'sub-agent.json'), 'sub-agent-pw', client);

      await expect(
        delegate(
          { to: subAgentWallet.getDID(), scopes: ['read:orders'], expiresIn: 3600 },
          delegatorWallet,
        ),
      ).rejects.toMatchObject({ code: 'MAX_DELEGATION_DEPTH_EXCEEDED' });
    } finally {
      await delegator.cleanup();
      await rm(dir, { recursive: true, force: true });
    }
  }, LIVE_HEDERA_TIMEOUT_MS);
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { signBytes } from '@helix-id/core';
import { HelixClient } from '../../../helix-sdk-js/src/client/HelixClient.js';
import { AgentWallet } from '../../../helix-sdk-js/src/wallet/AgentWallet.js';

const REALISTIC_DID = 'did:hedera:testnet:42ubDg7iWCsGJTemHKEUWDQifEHM3KPHTmQgN5Hofogm_0.0.8050123';
const REALISTIC_PRIVATE_KEY = '815ce1219c40cb2e864ca2411da7ba9eb4b8ed29dcc1d8c076392d2bbde2961e';

describe('Story 4 Realistic Agent And User Flows', () => {
  it('completes onboarding end to end through the SDK and persists the wallet', async () => {
    const client = new HelixClient('http://localhost:3000');
    const wallet = new AgentWallet();
    const dir = await mkdtemp(join(tmpdir(), 'helix-story4-onboard-'));
    const walletPath = join(dir, 'agent-wallet.json');

    try {
      const tokenRes = await fetch('http://localhost:3000/v1/enrollment-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentName: 'Story4 Realistic Agent',
          requestedScopes: ['read:orders', 'write:orders'],
          requestedDomains: ['https://story4.agent.example.com']
        })
      });

      expect(tokenRes.status).toBe(201);
      const tokenBody = await tokenRes.json() as { token: string };

      const challenge = await client.requestOnboardingChallenge(
        tokenBody.token,
        ['https://story4.agent.example.com']
      );

      const onboarding = await client.completeOnboarding(
        challenge.challengeId,
        challenge.nonce,
        'story4-passphrase',
        walletPath
      );

      expect(onboarding.agentDid).toMatch(/^did:helix:/);
      expect(onboarding.walletSaved).toBe(true);
      expect(onboarding.vcId).toBeTruthy();

      const savedWallet = await wallet.load('story4-passphrase', walletPath);
      expect(savedWallet.did).toBe(onboarding.agentDid);
      expect(savedWallet.vcId).toBe(onboarding.vcId);
      expect(savedWallet.privateKeyHex).toHaveLength(64);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('issues and verifies a real challenge response for an existing DID', async () => {
    const client = new HelixClient('http://localhost:3000');

    const challenge = await client.requestUserChallenge(REALISTIC_DID);
    const signature = await signBytes(Buffer.from(challenge.nonce, 'hex'), REALISTIC_PRIVATE_KEY);
    const verification = await client.verifyUserChallenge(challenge.challengeId, signature);

    expect(verification.verified).toBe(true);
    expect(verification.did).toBe(REALISTIC_DID);
    expect(verification.vc).toBeDefined();
  });
});

import { describe, expect, it } from 'vitest';
import { HelixClient } from '../../../src/client/HelixClient.js';

describe('HelixClient onboarding', () => {
  it('clears pending keypair after completeOnboarding', async () => {
    const client = new HelixClient('http://localhost:3000');
    client.__setTestHttpAdapter({
      post: async (path: string, payload: Record<string, unknown>) => {
        if (path === '/v1/onboard') {
          return { challengeId: 'chal:test', nonce: 'ab'.repeat(32), expiresAt: new Date().toISOString() };
        }
        if (path === '/v1/onboard/verify') {
          return {
            agentDid: 'did:hedera:testnet:agent1',
            vc: {},
            hederaTransactionId: 'tx-1',
            vcId: 'vc-1',
            signatureEcho: payload.signature
          };
        }
        throw new Error('unknown path');
      }
    } as any);

    const challenge = await client.requestOnboardingChallenge('enroll:test', ['https://myagent.example.com']);
    await client.completeOnboarding(challenge.challengeId, challenge.nonce, 'pass', '/tmp/helix-wallet-test.json');
    expect(client.__getPendingKeyPairForTest()).toBeNull();
  });
});

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HelixClient } from '../../../src/client/HelixClient.js';
async function withWalletPath(run) {
    const dir = await mkdtemp(join(tmpdir(), 'helix-onboarding-'));
    try {
        return await run(join(dir, 'wallet.json'));
    }
    finally {
        await rm(dir, { recursive: true, force: true });
    }
}
describe('HelixClient onboarding', () => {
    it('clears pending keypair after completeOnboarding', async () => {
        await withWalletPath(async (walletPath) => {
            const client = new HelixClient('http://localhost:3000');
            client.__setTestHttpAdapter({
                post: async (path, payload) => {
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
            });
            const challenge = await client.requestOnboardingChallenge('enroll:test', ['https://myagent.example.com']);
            await client.completeOnboarding(challenge.challengeId, challenge.nonce, 'pass', walletPath);
            expect(client.__getPendingKeyPairForTest()).toBeNull();
        });
    });
    it('signs Hiero DID creation payload locally during onboarding', async () => {
        await withWalletPath(async (walletPath) => {
            const client = new HelixClient('http://localhost:3000');
            let verifyPayload;
            client.__setTestHttpAdapter({
                post: async (path, payload) => {
                    if (path === '/v1/onboard') {
                        return {
                            challengeId: 'chal:test',
                            nonce: 'ab'.repeat(32),
                            expiresAt: new Date().toISOString(),
                            didCreateSigningPayloadHex: Buffer.from('hiero-create-did', 'utf8').toString('hex')
                        };
                    }
                    if (path === '/v1/onboard/verify') {
                        verifyPayload = payload;
                        return {
                            agentDid: 'did:hedera:testnet:agent1',
                            vc: {},
                            hederaTransactionId: 'tx-1',
                            vcId: 'vc-1'
                        };
                    }
                    throw new Error('unknown path');
                }
            });
            const challenge = await client.requestOnboardingChallenge('enroll:test', ['https://myagent.example.com']);
            await client.completeOnboarding(challenge.challengeId, challenge.nonce, 'pass', walletPath);
            expect(verifyPayload?.didCreateSignature).toMatch(/^[0-9a-f]{128}$/);
        });
    });
});
//# sourceMappingURL=onboarding.test.js.map
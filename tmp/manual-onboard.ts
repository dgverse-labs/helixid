import { HelixClient } from '../helix-sdk-js/src/client/HelixClient.js';
import { AgentWallet } from '../helix-sdk-js/src/wallet/AgentWallet.js';

async function main() {
  const token = process.argv[2];
  if (!token) throw new Error('Usage: pnpm exec tsx manual-onboard.ts <enrollment-token>');

  const client = new HelixClient('http://localhost:3000');

  const challenge = await client.requestOnboardingChallenge(token, [
    'https://manual.agent2.example.com'
  ]);

  console.log('challenge', challenge);

  const onboarding = await client.completeOnboarding(
    challenge.challengeId,
    challenge.nonce,
    'manual-passphrase',
    '/tmp/helix-manual-agent-wallet.json'
  );

  console.log('onboarding', onboarding);

  const wallet = new AgentWallet();
  const saved = await wallet.load('manual-passphrase', '/tmp/helix-manual-agent-wallet.json');

  console.log('saved wallet', {
    did: saved.did,
    publicKeyHex: saved.publicKeyHex,
    vcId: saved.vcId,
    hasPrivateKey: !!saved.privateKeyHex
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

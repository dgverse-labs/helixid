import { HelixClient } from '../helix-sdk-js/src/client/HelixClient.js';
import { AgentWallet } from '../helix-sdk-js/src/wallet/AgentWallet.js';

const API_BASE_URL = 'http://localhost:3000';
const WALLET_FILE_PATH = new URL('./helix-manual-agent-wallet.json', import.meta.url).pathname;
const WALLET_PASSPHRASE = 'manual-passphrase';
const AGENT_DOMAINS = ['https://manual.agent2.example.com'];

async function main() {
  const token = process.argv[2];
  if (!token) throw new Error('Usage: pnpm exec tsx manual-onboard.ts <enrollment-token>');

  const client = new HelixClient(API_BASE_URL);

  const challenge = await client.requestOnboardingChallenge(token, AGENT_DOMAINS);

  console.log('challenge', challenge);

  const onboarding = await client.completeOnboarding(
    challenge.challengeId,
    challenge.nonce,
    WALLET_PASSPHRASE,
    WALLET_FILE_PATH
  );

  console.log('onboarding', onboarding);

  const wallet = new AgentWallet();
  const saved = await wallet.load(WALLET_PASSPHRASE, WALLET_FILE_PATH);

  console.log('saved wallet', {
    did: saved.did,
    publicKeyHex: saved.publicKeyHex,
    credentialCount: saved.credentials.length,
    vcIds: saved.credentials.map((credential) => credential.vcId),
    walletFilePath: WALLET_FILE_PATH,
    hasPrivateKey: !!saved.privateKeyHex
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

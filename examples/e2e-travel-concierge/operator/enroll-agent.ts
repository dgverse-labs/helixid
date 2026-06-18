// e2e travel concierge/ operator /enroll-agent.ts

import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { AgentWallet, HelixClient } from '@helix-id/sdk-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const exampleRoot = dirname(__dirname);
const walletPath = join(exampleRoot, 'agent', 'wallet.enc');

const helixApiUrl = process.env.HELIX_API_URL ?? process.env.API_BASE_URL ?? 'http://localhost:3000';
const walletPassphrase = process.env.WALLET_PASSPHRASE ?? 'change-this-passphrase';

const requestedScopes = ['read:catalog', 'write:orders', 'read:inventory'];
const requestedDomains = ['https://travel-concierge.example.com'];

type EnrollmentTokenResponse = {
  token: string;
  expiresAt: string;
};

type AgentVC = {
  id: string;
  validUntil: string;
  credentialSubject: {
    privilegeScopes: string[];
  };
};

function log(actor: 'Agent Owner' | 'Helix ID' | 'Agent', message: string): void {
  console.log(`[${actor}] ${message}`);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };

  const response = await fetch(`${helixApiUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

async function main(): Promise<void> {
  await mkdir(dirname(walletPath), { recursive: true });

  log('Agent Owner', 'Creating one-use enrollment token for the travel concierge agent.');
  const enrollment = await postJson<EnrollmentTokenResponse>('/v1/enrollment-tokens', {
    agentName: 'E2E Travel Concierge',
    requestedScopes,
    requestedDomains,
    maxDelegationDepth: 0,
  });
  log('Agent Owner', `Enrollment token expires at ${enrollment.expiresAt}.`);

  log('Agent Owner', 'Simulating token handoff by keeping the token in this process only.');

  const client = new HelixClient(helixApiUrl);

  // The current SDK generates the agent keypair inside requestOnboardingChallenge.
  // That local keypair makes the agent, not Helix ID, the private-key holder.
  log('Agent', 'Generating keypair locally through the SDK; the private key is not transmitted.');
  log('Agent', 'Submitting only the public key and requested domains to Helix ID.');
  const challenge = await client.requestOnboardingChallenge(enrollment.token, requestedDomains);

  log('Helix ID', 'Enrollment token burned. DID creation is prepared for Hedera HCS anchoring.');
  log('Helix ID', `Challenge nonce issued; challenge expires at ${challenge.expiresAt}.`);

  // Completing onboarding signs the challenge nonce and DID creation payload locally.
  // That proves key ownership before Helix ID issues a credential for the new DID.
  log('Agent', 'Signing the challenge locally with Ed25519; the private key stays in the agent process.');
  const onboarding = await client.completeOnboarding(
    challenge.challengeId,
    challenge.nonce,
    walletPassphrase,
    walletPath,
  );

  log('Helix ID', `VC issued for ${onboarding.agentDid}.`);

  // The SDK's AgentWallet encrypts the private key and stores DID, public key, and issued credentials.
  // The private key never left the process; Helix ID only saw signatures and the public key.
  const walletStore = new AgentWallet();
  const wallet = await walletStore.load(walletPassphrase, walletPath);
  const credential = await walletStore.getLatestCredential({ vcType: 'HelixAgentCredential' }, walletPassphrase, walletPath);
  if (!credential) throw new Error('Wallet has no credentials after onboarding');
  const vc = JSON.parse(credential.vcJson) as AgentVC;

  log('Agent', `Wallet saved to ${walletPath}.`);
  log('Agent', `DID: ${wallet.did}`);
  log('Agent', `VC id: ${credential.vcId}`);
  log('Agent', `Scopes: ${vc.credentialSubject.privilegeScopes.join(', ')}`);
  log('Agent', `Credential expiry: ${vc.validUntil}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

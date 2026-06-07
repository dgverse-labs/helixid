import 'dotenv/config';
import { AgentWallet } from '@helix-id/sdk-js';
import {
  createHelixClient,
  ensureAgentDirectory,
  helixApiUrl,
  logStep,
  requestedDomains,
  requestedScopes,
  walletPassphrase,
  walletPath,
  type WalletVC,
} from './shared.js';

type EnrollmentTokenResponse = {
  token: string;
  expiresAt: string;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${helixApiUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
}

async function assertApiAvailable(): Promise<void> {
  const response = await fetch(`${helixApiUrl}/health`);
  if (!response.ok) {
    throw new Error(`Helix API health check failed with ${response.status}. Start the API before running setup.`);
  }
}

async function main(): Promise<void> {
  await ensureAgentDirectory();
  await assertApiAvailable();

  logStep('Setup', `Using Helix API at ${helixApiUrl}`);
  logStep('Agent Owner', 'Creating a one-use enrollment token through the live API.');
  const enrollment = await postJson<EnrollmentTokenResponse>('/v1/enrollment-tokens', {
    agentName: 'Framework Middleware Demo Agent',
    requestedScopes,
    requestedDomains,
    maxDelegationDepth: 0,
  });
  logStep('Agent Owner', `Enrollment token expires at ${enrollment.expiresAt}.`);

  const client = createHelixClient();
  logStep('Agent', 'Generating an agent keypair locally and requesting the onboarding challenge.');
  const challenge = await client.requestOnboardingChallenge(enrollment.token, requestedDomains);
  logStep('Helix ID', `Challenge ${challenge.challengeId} issued; DID creation is prepared for real Hedera anchoring.`);

  logStep('Agent', 'Signing the challenge locally and completing onboarding.');
  const onboarding = await client.completeOnboarding(
    challenge.challengeId,
    challenge.nonce,
    walletPassphrase,
    walletPath,
  );

  const walletStore = new AgentWallet();
  const wallet = await walletStore.load(walletPassphrase, walletPath);
  const credential = await walletStore.getLatestCredential({ vcType: 'HelixAgentCredential' }, walletPassphrase, walletPath);
  if (!credential) throw new Error('Wallet has no HelixAgentCredential after onboarding');
  const vc = JSON.parse(credential.vcJson) as WalletVC;
  const expiresAt = vc.validUntil ?? vc.expirationDate ?? 'unknown';

  logStep('Helix ID', `Issued VC ${onboarding.vcId} for ${onboarding.agentDid}.`);
  logStep('Agent', `Encrypted wallet saved to ${walletPath}.`);
  logStep('Agent', `DID: ${wallet.did}`);
  logStep('Agent', `Selected VC id: ${credential.vcId}`);
  logStep('Agent', `Scopes: ${requestedScopes.join(', ')}`);
  logStep('Agent', `Credential expiry: ${expiresAt}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

import 'dotenv/config';
import { access } from 'node:fs/promises';
import { AgentWallet } from '@helixid/sdk-js';
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
    throw new Error(
      `Helix API health check failed with ${response.status}. Start the API before running setup.`,
    );
  }
}

async function walletExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await ensureAgentDirectory();

  const walletStore = new AgentWallet();
  if (await walletExists(walletPath)) {
    logStep('Setup', `Found existing wallet at ${walletPath}; skipping enrollment.`);
    const wallet = await walletStore.load(walletPassphrase, walletPath);
    const credential = await walletStore.getLatestCredential(
      { vcType: 'HelixAgentCredential' },
      walletPassphrase,
      walletPath,
    );
    if (!credential) throw new Error('Wallet has no HelixAgentCredential');
    const vc = JSON.parse(credential.vcJson) as WalletVC;
    const expiresAt = vc.validUntil ?? vc.expirationDate ?? 'unknown';

    logStep('Agent', `DID: ${wallet.did}`);
    logStep('Agent', `Selected VC id: ${credential.vcId}`);
    logStep('Agent', `Credential expiry: ${expiresAt}`);
    return;
  }

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
  logStep('Agent', 'Creating a local did:key wallet and enrolling with the bootstrap token.');

  // Create and persist a local did:key wallet (AgentWallet.create writes the file)
  const wallet = await AgentWallet.create(walletPath, walletPassphrase);
  logStep('Agent', `Generated local DID ${wallet.did} and saved wallet to ${walletPath}.`);

  // Use the enroll endpoint (POST /v1/enroll). This posts the bootstrap token and a
  // wallet-signed bootstrap proof to the API. Unlike the onboard flow, this does not
  // prepare a Hedera anchoring request on the server and works with did:key local DIDs.
  logStep('Agent', 'Enrolling with Helix API using bootstrap token (POST /v1/enroll).');
  const issuedVC = await client.enroll(enrollment.token, wallet);

  // Load the saved wallet and extract the HelixAgentCredential metadata for logging
  const credential = await wallet.getLatestCredential(
    { vcType: 'HelixAgentCredential' },
    walletPassphrase,
    walletPath,
  );
  if (!credential) throw new Error('Wallet has no HelixAgentCredential after enrollment');
  const vc = JSON.parse(credential.vcJson) as WalletVC;
  const expiresAt = vc.validUntil ?? vc.expirationDate ?? 'unknown';

  logStep('Helix ID', `Issued VC ${credential.vcId} for ${wallet.did}.`);
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
